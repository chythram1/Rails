import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { sessionKey, type Project, type SessionSummary } from "@rails/shared";
import { layouts, panels, projects } from "./db.ts";
import { pickFolder } from "./picker.ts";
import { sessionsFor } from "./providers/index.ts";

/** An expected failure with the HTTP status the route should answer with. */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

export function getProject(id: string): Project {
  const project = projects.get(id);
  if (!project) throw new ServiceError("Not found", 404);
  return project;
}

/** Attach a directory as a project. `~` is expanded and the path is stored as a realpath. */
export function attachProject(rawPath: string | undefined, name?: string): Project {
  if (!rawPath) throw new ServiceError("path is required", 400);
  const expanded = resolve(rawPath.replace(/^~(?=\/|$)/, process.env.HOME ?? "~")).replace(/\/+$/, "") || "/";
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) throw new ServiceError("Not a directory", 400);
  const path = realpathSync(expanded); // agents record the real cwd (e.g. /tmp -> /private/tmp)
  if (projects.list().some((p) => p.path === path)) throw new ServiceError("Project already attached", 409);
  return projects.create(name?.trim() || basename(path), path);
}

/**
 * Remove a project from rails. Transcripts are untouched, so attaching the same path later brings
 * every session back. Refused while the project has open panels, so nothing is stopped by surprise.
 */
export function detachProject(id: string): void {
  getProject(id);
  const n = panels.list(id).length;
  if (n > 0) throw new ServiceError(`Close the ${n} open panel${n === 1 ? "" : "s"} in this project first.`, 409);
  layouts.remove(id);
  projects.remove(id);
}

/**
 * Let the user choose a folder in the server's native folder picker and attach it. Picking a folder
 * that is already a project returns that project. Returns null if the user cancelled.
 */
export async function attachPickedFolder(): Promise<Project | null> {
  const path = await pickFolder();
  if (!path) return null;
  const real = realpathSync(path);
  return projects.list().find((p) => p.path === real) ?? attachProject(real);
}

/** Sessions discovered inside a project's directory, newest first, with their open panel (if any). */
export async function listProjectSessions(projectId: string): Promise<SessionSummary[]> {
  const project = getProject(projectId);
  const panelBySession = new Map(panels.list(projectId).map((p) => [p.sessionId, p.id]));
  const found = await sessionsFor(project.path);
  return found.map((s) => ({
    key: sessionKey(s.provider, s.id),
    provider: s.provider,
    id: s.id,
    cwd: s.cwd,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    panelId: panelBySession.get(s.id),
  }));
}
