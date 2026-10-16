import { randomUUID } from "node:crypto";
import type { Panel, PanelKind, ProviderId, Workspace } from "@rails/shared";
import { layouts, panels } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { getProject } from "./projects.ts";
import { discovery, findSession, installed } from "./providers/index.ts";
import * as tmux from "./tmux.ts";

/** Command line that reopens an existing session in its agent's TUI. */
function resumeCommand(provider: ProviderId, sessionId: string): string[] {
  switch (provider) {
    case "claude":
      return ["claude", "--resume", sessionId];
    case "pi":
      return ["pi", "--session", sessionId];
    case "codex":
      return ["codex", "resume", sessionId];
  }
}

/**
 * Command line for a new panel; `prompt` becomes the agent's first message. Claude and pi accept a
 * session id up front, so for them the panel knows its session immediately.
 */
function newCommand(kind: PanelKind, prompt: string | undefined): { argv: string[]; sessionId?: string } {
  const first = prompt ? ["--", prompt] : [];
  const sessionId = randomUUID();
  switch (kind) {
    case "claude":
      return { sessionId, argv: ["claude", "--session-id", sessionId, ...first] };
    case "pi":
      return { sessionId, argv: ["pi", "--session-id", sessionId, ...first] };
    case "codex":
      return { argv: ["codex", ...first] };
    case "shell":
      return { argv: [process.env.SHELL || "/bin/sh", "-l"] };
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
      const argv = resumeCommand(req.kind, req.sessionId);
      if (!state) await tmux.startSession(existing.id, cwd, argv);
      else if (state.dead) await tmux.respawn(existing.id, cwd, argv);
      return existing;
    }
    if (!found) throw new ServiceError("Session transcript not found", 404);
    return start(project.id, req.kind, req.sessionId, found.title, found.cwd, resumeCommand(req.kind, req.sessionId));
  }

  const { argv, sessionId } = newCommand(req.kind, req.prompt?.trim() || undefined);
  const title = req.kind === "shell" ? "Shell" : discovery[req.kind].name;
  return start(project.id, req.kind, sessionId, title, project.path, argv);
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
