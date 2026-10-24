import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { OpenPanel, Panel, PanelKind, ProviderId, Workspace } from "@rails/shared";
import { layouts, panels } from "./db.ts";
import { bridgeEnv, forgetPanel, onSessionMoved } from "./bridge/index.ts";
import { onCodexSession, startCodexThread, unwatchCodexIfIdle, watchCodex } from "./bridge/codex.ts";
import { bridgeFlags } from "./bridge/wiring.ts";
import { ServiceError } from "./errors.ts";
import { getProject } from "./projects.ts";
import { discovery, findSession, installed } from "./providers/index.ts";
import { sessionName } from "./titles.ts";
import * as tmux from "./tmux.ts";
import { listeners } from "./util.ts";

/**
 * The user's login shell from their account. Not $SHELL: shells like `nix develop` set it to their own
 * bash, which would make every shell panel bash instead of the user's shell.
 */
function loginShell(): string {
  let shell: string | null = null;
  try {
    shell = userInfo().shell; // throws if the user has no passwd entry (rare, e.g. some containers)
  } catch {}
  return shell || process.env.SHELL || "/bin/sh";
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
 * session id up front, so for them the panel knows its session immediately. For Codex, Rails starts the thread
 * itself, with its agent tools (ADR 0030), and the panel resumes it; if Codex can't, the panel runs plain `codex`,
 * without them, and the bridge learns its thread from the daemon.
 */
async function newCommand(kind: PanelKind, prompt: string | undefined, cwd: string): Promise<{ argv: string[]; sessionId?: string }> {
  const first = prompt ? ["--", prompt] : [];
  const sessionId = randomUUID();
  switch (kind) {
    case "claude":
      return { sessionId, argv: ["claude", "--session-id", sessionId, ...first] };
    case "pi":
      return { sessionId, argv: ["pi", "--session-id", sessionId, ...first] };
    case "codex": {
      const threadId = await startCodexThread(cwd, panels.all()).catch((e) => void console.warn(`Codex panel without Rails' tools: ${e.message}`));
      return threadId ? { sessionId: threadId, argv: ["codex", "resume", threadId, ...first] } : { argv: ["codex", ...first] };
    }
    case "shell":
      return { argv: [loginShell(), "-l"] };
  }
}

// ---- change notifications (the terminal hub forwards these to every browser) ----
const panelChanges = listeners<[projectId: string]>();
export const onPanelsChanged = panelChanges.on;
const changed = panelChanges.emit;
/** For a session renamed (names.ts): browsers reload the panels and sessions, and so their titles. */
export const panelsChanged = changed;

/**
 * Codex picks a new session's id itself; the bridge learns it from Codex's daemon (bridge/codex.ts). It may move a
 * new panel on to another thread, the one Codex really uses (CodexWatcher.started), and a panel whose Codex moved
 * to another thread (`/new`, `/fork`, `/resume`) follows it there.
 */
export function linkCodexThread(panelId: string, threadId: string): void {
  const panel = panels.get(panelId);
  if (!panel || panels.bySession(threadId)) return;
  panels.setSession(panelId, threadId);
  changed(panel.projectId);
}
onCodexSession(linkCodexThread);
// Claude Code's and pi's panels follow their session to another (`/clear`, `/new`, `/resume`; bridge/index.ts).
onSessionMoved((panel) => changed(panel.projectId));

/**
 * Drop a panel whose process ended and tell every browser. It never stops a process: only closing a panel does
 * (`closePanel`), so a wrong guess that it ended can't kill an agent.
 */
function dropPanel(panel: Panel): void {
  panels.remove(panel.id);
  forgetPanel(panel.id);
  if (panel.kind === "codex") unwatchCodexIfIdle();
  changed(panel.projectId);
}

/**
 * Panels whose process is starting: they're in the database, not yet in tmux. Not running isn't ended for them, so
 * they're neither shown nor removed until they run. (Opening a session from another page loads the workspace while
 * its panel starts; the load used to take it for ended and remove it.)
 */
const starting = new Set<string>();

/** Called when a browser's tmux client exits on its own: if the panel's process ended, remove the panel. */
export async function panelEnded(id: string): Promise<void> {
  const panel = panels.get(id);
  if (panel && !starting.has(id) && !(await tmux.runningPanels()).has(id)) dropPanel(panel);
}

/** A project's panels and saved layout. Panels whose process ended while nobody was watching are dropped. */
export async function getWorkspace(projectId: string): Promise<Workspace> {
  getProject(projectId);
  const running = await tmux.runningPanels();
  const list: Panel[] = [];
  for (const p of panels.list(projectId)) {
    if (starting.has(p.id)) continue; // shown once it runs (panels.changed)
    if (running.has(p.id)) {
      const name = sessionName(p);
      list.push(name ? { ...p, name } : p);
    }
    else dropPanel(p);
  }
  return { panels: list, layout: layouts.get(projectId) };
}

/**
 * Sessions being opened right now. A second request for the same session (React's StrictMode runs effects
 * twice in development; two devices can click at once) waits for the first instead of racing it to the
 * database, where one panel per session is enforced.
 */
const opening = new Map<string, Promise<Panel>>();

/** Open a panel. Opening a session that already has a running panel returns that panel. */
export async function openPanel(projectId: string, req: OpenPanel): Promise<Panel> {
  const project = getProject(projectId);
  if (!["claude", "codex", "pi", "shell"].includes(req.kind)) throw new ServiceError("Unknown panel kind", 400);
  if (req.kind !== "shell" && !installed(req.kind)) throw new ServiceError(`${discovery[req.kind].name} isn't installed on the server`, 400);

  if (req.sessionId) {
    if (req.kind === "shell") throw new ServiceError("Shells have no sessions", 400);
    const { sessionId } = req;
    const inFlight = opening.get(sessionId);
    if (inFlight) return inFlight;
    const open = openSession(project.id, req.kind, sessionId).finally(() => opening.delete(sessionId));
    opening.set(sessionId, open);
    return open;
  }

  const { argv, sessionId } = await newCommand(req.kind, req.prompt?.trim() || undefined, project.path);
  const title = req.kind === "shell" ? "Shell" : discovery[req.kind].name;
  return start(project.id, req.kind, sessionId, title, project.path, argv);
}

/** Resume a discovered session in a panel, or return the panel it's already running in. */
async function openSession(projectId: string, kind: ProviderId, sessionId: string): Promise<Panel> {
  const existing = panels.bySession(sessionId);
  if (existing) {
    if ((await tmux.runningPanels()).has(existing.id)) return existing;
    dropPanel(existing); // its process ended but nobody noticed yet; start a fresh panel
  }
  const found = await findSession(kind, sessionId);
  if (!found) throw new ServiceError("Session transcript not found", 404);
  return start(projectId, kind, sessionId, found.title, found.cwd, resumeCommand(kind, sessionId));
}

async function start(projectId: string, kind: PanelKind, sessionId: string | undefined, title: string, cwd: string, argv: string[]) {
  const panel = panels.create({ projectId, kind, sessionId, title });
  starting.add(panel.id);
  try {
    // Agents report to the bridge (ADR 0007): their flags go after the program name, the token in the env.
    const [program, ...rest] = argv;
    const wired = kind === "shell" ? argv : [program, ...bridgeFlags(kind, panel.id), ...rest];
    await tmux.startSession(panel.id, cwd, wired, kind === "shell" ? {} : bridgeEnv(panel.id));
  } catch (e) {
    panels.remove(panel.id);
    throw e;
  } finally {
    starting.delete(panel.id);
  }
  if (kind === "codex") watchCodex(panels.all(), sessionId ? undefined : { panelId: panel.id, cwd });
  changed(projectId);
  return panel;
}

/** Close a panel: stops its process. The transcript stays, so the session can be resumed. */
export async function closePanel(id: string): Promise<void> {
  const panel = panels.get(id);
  if (!panel) throw new ServiceError("Not found", 404);
  await tmux.killSession(panel.id); // stops the process; already gone is fine
  dropPanel(panel);
}

export function saveLayout(projectId: string, layout: unknown): void {
  getProject(projectId);
  layouts.set(projectId, layout);
}
