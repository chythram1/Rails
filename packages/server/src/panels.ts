import { randomUUID } from "node:crypto";
import type { Panel, PanelKind, Workspace } from "@rails/shared";
import { layouts, panels } from "./db.ts";
import { getProject, ServiceError } from "./projects.ts";
import { discovery, findSession, installed } from "./providers/index.ts";
import * as tmux from "./tmux.ts";

/** Command line for a panel. `resume` reopens an existing session; otherwise a new one starts. */
function command(kind: PanelKind, sessionId: string | undefined, resume: boolean, prompt?: string): string[] {
  const first = prompt ? ["--", prompt] : [];
  switch (kind) {
    case "claude":
      return resume ? ["claude", "--resume", sessionId!] : ["claude", "--session-id", sessionId!, ...first];
    case "pi":
      return resume ? ["pi", "--session", sessionId!] : ["pi", "--session-id", sessionId!, ...first];
    case "codex":
      return resume ? ["codex", "resume", sessionId!] : ["codex", ...first];
    case "shell":
      return [process.env.SHELL || "/bin/sh", "-l"];
  }
}

// ---- change notifications (the terminal hub forwards these to every browser) ----
const listeners = new Set<(projectId: string) => void>();
export const onPanelsChanged = (fn: (projectId: string) => void) => listeners.add(fn);
const changed = (projectId: string) => listeners.forEach((fn) => fn(projectId));

/** A project's panels and saved layout. Panels whose tmux session vanished (e.g. reboot) are dropped. */
export async function getWorkspace(projectId: string): Promise<Workspace> {
  getProject(projectId);
  const states = await tmux.sessionStates();
  const list: Panel[] = [];
  for (const p of panels.list(projectId)) {
    const state = states.get(p.id);
    if (!state) panels.remove(p.id);
    else list.push({ ...p, exited: state.dead });
  }
  return { panels: list, layout: layouts.get(projectId) };
}

export interface OpenPanel {
  kind: PanelKind;
  /** Resume this existing session instead of starting a new one. */
  sessionId?: string;
  /** First message for a new agent session. */
  prompt?: string;
}

/**
 * Open a panel. Opening a session that already has a panel returns that panel, restarting its
 * process if it had exited.
 */
export async function openPanel(projectId: string, req: OpenPanel): Promise<Panel> {
  const project = getProject(projectId);
  if (!["claude", "codex", "pi", "shell"].includes(req.kind)) throw new ServiceError("Unknown panel kind", 400);
  if (req.kind !== "shell" && !installed(req.kind)) throw new ServiceError(`${discovery[req.kind].name} isn't installed on the server`, 400);

  if (req.sessionId) {
    if (req.kind === "shell") throw new ServiceError("Shells have no sessions", 400);
    const found = await findSession(req.kind, req.sessionId);
    const existing = panels.bySession(req.sessionId);
    if (existing) {
      const state = (await tmux.sessionStates()).get(existing.id);
      const cwd = found?.cwd ?? project.path;
      const argv = command(req.kind, req.sessionId, true);
      if (!state) await tmux.startSession(existing.id, cwd, argv);
      else if (state.dead) await tmux.respawn(existing.id, cwd, argv);
      return existing;
    }
    if (!found) throw new ServiceError("Session transcript not found", 404);
    return start(project.id, req.kind, req.sessionId, found.title, found.cwd, command(req.kind, req.sessionId, true));
  }

  // Claude and pi accept a session id up front, so the panel knows its session immediately.
  const sessionId = req.kind === "claude" || req.kind === "pi" ? randomUUID() : undefined;
  const title = req.kind === "shell" ? "Shell" : discovery[req.kind].name;
  return start(project.id, req.kind, sessionId, title, project.path, command(req.kind, sessionId, false, req.prompt?.trim() || undefined));
}

async function start(projectId: string, kind: PanelKind, sessionId: string | undefined, title: string, cwd: string, argv: string[]) {
  const panel = panels.create({ projectId, kind, sessionId, title });
  try {
    await tmux.startSession(panel.id, cwd, argv);
  } catch (e) {
    panels.remove(panel.id);
    throw e;
  }
  changed(projectId);
  return panel;
}

/** Close a panel: stops its process. The transcript stays, so the session can be resumed. */
export async function closePanel(id: string): Promise<void> {
  const panel = panels.get(id);
  if (!panel) throw new ServiceError("Not found", 404);
  await tmux.killSession(id);
  panels.remove(id);
  changed(panel.projectId);
}

export function saveLayout(projectId: string, layout: unknown): void {
  getProject(projectId);
  layouts.set(projectId, layout);
}
