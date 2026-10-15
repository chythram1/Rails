import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { sessionKey, type LiveStatus, type Project, type SessionKey, type SessionSummary } from "@rails/shared";
import { projects } from "./db.ts";
import { sessionsFor } from "./providers/index.ts";

/** An expected failure with the HTTP status the route should answer with. */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
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

/** Sessions discovered inside a project's directory, newest first, with live status attached. */
export async function listProjectSessions(
  projectId: string,
  liveStatus: (key: SessionKey) => LiveStatus | undefined,
): Promise<SessionSummary[]> {
  const project = getProject(projectId);
  const found = await sessionsFor(project.path);
  return found.map((s) => {
    const key = sessionKey(s.provider, s.id);
    return { key, provider: s.provider, id: s.id, cwd: s.cwd, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, liveStatus: liveStatus(key) };
  });
}
