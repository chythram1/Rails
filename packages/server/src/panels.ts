import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { AgentProfile, OpenPanel, Panel, PanelKind, ProviderId, Workspace } from "@rails/shared";
import { layouts, panels } from "./db.ts";
import { bridgeEnv, forgetPanel } from "./bridge/index.ts";
import { onCodexSession, unwatchCodexIfIdle, watchCodex } from "./bridge/codex.ts";
import { bridgeFlags } from "./bridge/wiring.ts";
import { launchProfile } from "./customize.ts";
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

/**
 * Flags for a profile's launch options (ADR 0020), inserted after the program name. Each value is its own
 * argv entry (tmux execs argv as-is), so instructions and tool patterns need no quoting. Only Claude Code has
 * profiles so far.
 */
export function profileFlags(kind: PanelKind, profile: AgentProfile | undefined): string[] {
  if (!profile || kind !== "claude") return [];
  const flags: string[] = [];
  if (profile.model) flags.push("--model", profile.model);
  if (profile.effort) flags.push("--effort", profile.effort);
  if (profile.permissionMode) flags.push("--permission-mode", profile.permissionMode);
  if (profile.instructions) flags.push("--append-system-prompt", profile.instructions);
  // Tool lists take several values; the next argv entry is always another flag or `--`, which ends them.
  if (profile.allowedTools.length) flags.push("--allowed-tools", ...profile.allowedTools);
  if (profile.disallowedTools.length) flags.push("--disallowed-tools", ...profile.disallowedTools);
  return flags;
}

// ---- change notifications (the terminal hub forwards these to every browser) ----
const panelChanges = listeners<[projectId: string]>();
export const onPanelsChanged = panelChanges.on;
const changed = panelChanges.emit;
/** For a session renamed (names.ts): browsers reload the panels and sessions, and so their titles. */
export const panelsChanged = changed;

/**
 * Codex picks a new session's id itself; the bridge learns it from Codex's daemon (bridge/codex.ts). It may move a
 * new panel on to another thread, the one Codex really uses (CodexWatcher.started); resumed panels never get here.
 */
export function linkCodexThread(panelId: string, threadId: string): void {
  const panel = panels.get(panelId);
  if (!panel || panels.bySession(threadId)) return;
  panels.setSession(panelId, threadId);
  changed(panel.projectId);
}
onCodexSession(linkCodexThread);

/** Stop a panel's tmux session (if still there), drop the panel and tell every browser. */
async function removePanel(panel: Panel): Promise<void> {
  await tmux.killSession(panel.id); // stops the process; already gone is fine
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
  if (panel && !starting.has(id) && !(await tmux.runningPanels()).has(id)) await removePanel(panel);
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
    else await removePanel(p);
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
  const profile = launchProfile(req.kind, req.profileId);

  if (req.sessionId) {
    if (req.kind === "shell") throw new ServiceError("Shells have no sessions", 400);
    const { sessionId } = req;
    const inFlight = opening.get(sessionId);
    if (inFlight) return inFlight;
    const open = openSession(project.id, req.kind, sessionId, profile).finally(() => opening.delete(sessionId));
    opening.set(sessionId, open);
    return open;
  }

  const { argv, sessionId } = newCommand(req.kind, req.prompt?.trim() || undefined);
  const title = req.kind === "shell" ? "Shell" : discovery[req.kind].name;
  return start(project.id, req.kind, sessionId, title, project.path, argv, profile);
}

/** Resume a discovered session in a panel, or return the panel it's already running in. */
async function openSession(projectId: string, kind: ProviderId, sessionId: string, profile: AgentProfile | undefined): Promise<Panel> {
  const existing = panels.bySession(sessionId);
  if (existing) {
    if ((await tmux.runningPanels()).has(existing.id)) return existing;
    await removePanel(existing); // its process ended but nobody noticed yet; start a fresh panel
  }
  const found = await findSession(kind, sessionId);
  if (!found) throw new ServiceError("Session transcript not found", 404);
  return start(projectId, kind, sessionId, found.title, found.cwd, resumeCommand(kind, sessionId), profile);
}

async function start(projectId: string, kind: PanelKind, sessionId: string | undefined, title: string, cwd: string, argv: string[], profile?: AgentProfile) {
  const panel = panels.create({
    projectId,
    kind,
    sessionId,
    title,
    ...(profile ? { profile: { id: profile.id, name: profile.name, model: profile.model, effort: profile.effort, permissionMode: profile.permissionMode } } : {}),
  });
  starting.add(panel.id);
  try {
    // Agents report to the bridge (ADR 0007): their flags go after the program name, the token in the env.
    // A profile's flags (ADR 0020) follow them.
    const [program, ...rest] = argv;
    const wired = kind === "shell" ? argv : [program, ...bridgeFlags(kind, panel.id), ...profileFlags(kind, profile), ...rest];
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
  await removePanel(panel);
}

export function saveLayout(projectId: string, layout: unknown): void {
  getProject(projectId);
  layouts.set(projectId, layout);
}
