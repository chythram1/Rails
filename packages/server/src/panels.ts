import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { Panel, PanelKind, ProviderId, Workspace } from "@rails/shared";
import { layouts, panels } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { getProject } from "./projects.ts";
import { discovery, findSession, installed } from "./providers/index.ts";
import * as tmux from "./tmux.ts";

/**
 * The user's login shell from their account. Not $SHELL: shells like `nix develop` set it to their own
 * bash, which would make every shell panel bash instead of the user's shell.
 */
function loginShell(): string {
  try {
    return userInfo().shell || process.env.SHELL || "/bin/sh";
  } catch {
    return process.env.SHELL || "/bin/sh";
  }
}

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
      return { argv: [loginShell(), "-l"] };
  }
}

// ---- change notifications (the terminal hub forwards these to every browser) ----
const listeners = new Set<(projectId: string) => void>();
export const onPanelsChanged = (fn: (projectId: string) => void) => listeners.add(fn);
const changed = (projectId: string) => listeners.forEach((fn) => fn(projectId));

// ---- experimental: warn before resuming a session that's running in another terminal ----
// A transcript written very recently, and not by a rails panel, probably belongs to an agent running
// elsewhere; resuming it here would start a second process on the same session. Heuristic: an agent
// idling in another terminal for longer than ACTIVE_MS isn't detected.
const ACTIVE_MS = 2 * 60_000;
/** sessionId -> when a rails panel for it last stopped, so rails' own recent writes don't count. */
const stoppedInRails = new Map<string, number>();

function refuseIfActiveElsewhere(sessionId: string, updatedAt: string) {
  const written = Date.parse(updatedAt);
  const ours = written <= (stoppedInRails.get(sessionId) ?? 0) + 5_000;
  const age = Date.now() - written;
  if (ours || age > ACTIVE_MS) return;
  const ago = age < 60_000 ? `${Math.max(1, Math.round(age / 1000))}s` : `${Math.round(age / 60_000)}m`;
  throw new ServiceError(
    `This session was updated ${ago} ago, probably by an agent running in another terminal. Opening it here starts a second copy that won't see the other's new messages.`,
    409,
    "session_active",
  );
}

/** Drop a panel whose process ended (`exit`, a crash, a reboot) and tell every browser. */
async function removeEnded(panel: Panel): Promise<void> {
  if (panel.sessionId) stoppedInRails.set(panel.sessionId, Date.now());
  await tmux.killSession(panel.id); // clears a dead pane left by older rails versions
  panels.remove(panel.id);
  changed(panel.projectId);
}

/** Called when a browser's tmux client exits on its own: if the panel's process ended, remove the panel. */
export async function panelEnded(id: string): Promise<void> {
  const panel = panels.get(id);
  if (panel && !(await tmux.runningPanels()).has(id)) await removeEnded(panel);
}

/** A project's panels and saved layout. Panels whose process ended while nobody was watching are dropped. */
export async function getWorkspace(projectId: string): Promise<Workspace> {
  getProject(projectId);
  const running = await tmux.runningPanels();
  const list: Panel[] = [];
  for (const p of panels.list(projectId)) {
    if (running.has(p.id)) list.push(p);
    else await removeEnded(p);
  }
  return { panels: list, layout: layouts.get(projectId) };
}

export interface OpenPanel {
  kind: PanelKind;
  /** Resume this existing session instead of starting a new one. */
  sessionId?: string;
  /** First message for a new agent session. */
  prompt?: string;
  /** Resume even if the session looks active in another terminal (experimental check). */
  force?: boolean;
}

/** Open a panel. Opening a session that already has a running panel returns that panel. */
export async function openPanel(projectId: string, req: OpenPanel): Promise<Panel> {
  const project = getProject(projectId);
  if (!["claude", "codex", "pi", "shell"].includes(req.kind)) throw new ServiceError("Unknown panel kind", 400);
  if (req.kind !== "shell" && !installed(req.kind)) throw new ServiceError(`${discovery[req.kind].name} isn't installed on the server`, 400);

  if (req.sessionId) {
    if (req.kind === "shell") throw new ServiceError("Shells have no sessions", 400);
    const found = await findSession(req.kind, req.sessionId);
    const existing = panels.bySession(req.sessionId);
    if (existing) {
      if ((await tmux.runningPanels()).has(existing.id)) return existing;
      await removeEnded(existing); // its process ended but nobody noticed yet; start a fresh panel
    }
    if (!found) throw new ServiceError("Session transcript not found", 404);
    if (!req.force) refuseIfActiveElsewhere(req.sessionId, found.updatedAt);
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
  if (panel.sessionId) stoppedInRails.set(panel.sessionId, Date.now());
  await tmux.killSession(id);
  panels.remove(id);
  changed(panel.projectId);
}

export function saveLayout(projectId: string, layout: unknown): void {
  getProject(projectId);
  layouts.set(projectId, layout);
}
