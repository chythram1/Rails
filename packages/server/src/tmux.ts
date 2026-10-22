// Every panel's process runs in its own tmux session on a socket private to RAILS_HOME (ADR 0003).
// Processes therefore outlive the rails server, and each browser attaches as its own tmux client.
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { spawn, type IPty } from "node-pty";
import { RAILS_HOME } from "./config.ts";
import { ServiceError } from "./errors.ts";

const run = promisify(execFile);

export const SOCKET = join(RAILS_HOME, "tmux.sock");
const CONF = join(RAILS_HOME, "tmux.conf");

writeFileSync(
  CONF,
  [
    "set -g status off", // the web UI shows tabs; no tmux status bar
    "set -g mouse on", // wheel scrolls tmux history (the browser terminal only sees the screen)
    "set -g history-limit 50000",
    "set -s escape-time 0", // TUIs need Esc without delay
    "set -g remain-on-exit off", // a panel's session ends with its process, so the panel closes itself
    "set -g window-size latest", // several devices: the one typing last sets the size
    'set -g default-terminal "tmux-256color"',
    'set -as terminal-features ",xterm-256color:RGB"',
    "set -g focus-events on",
    "set -s extended-keys on", // pass modified keys (e.g. Shift+Enter) through to the TUIs
  ].join("\n") + "\n",
);

/**
 * Environment for tmux and everything it starts. Drops rails' own and npm's variables (the access
 * token must not leak into agents) plus markers of a parent agent session.
 */
export function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(npm_|RAILS_|PI_|CLAUDE_CODE_)|^(CLAUDECODE|NODE_ENV|INIT_CWD)$/.test(k)) continue;
    env[k] = v;
  }
  env.LANG ??= "en_US.UTF-8"; // tmux only draws UTF-8 when the locale says so
  return env;
}

const MISSING = "tmux isn't installed on the server. Run `make system-deps` (or install tmux >= 3.2), then restart Rails.";

async function tmux(...args: string[]) {
  try {
    // From RAILS_HOME, not the server's own folder: the first call starts the tmux server, which keeps that
    // folder as its working directory for as long as it runs (it outlives Rails). If that folder is deleted
    // (a removed git worktree), tmux stops honouring `-c` and every new panel starts in a folder that no
    // longer exists, so agents quit at once.
    return await run("tmux", ["-S", SOCKET, "-f", CONF, ...args], { env: cleanEnv(), cwd: RAILS_HOME });
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new ServiceError(MISSING, 503);
    throw e;
  }
}

/** tmux's version string, or null when tmux isn't installed. */
export async function version(): Promise<string | null> {
  try {
    return (await run("tmux", ["-V"])).stdout.trim();
  } catch {
    return null;
  }
}

const sessionName = (panelId: string) => `p-${panelId}`;

/** Start `argv` detached in a new tmux session for the panel, with `env` added to its environment. */
export async function startSession(panelId: string, cwd: string, argv: string[], env: Record<string, string> = {}): Promise<void> {
  const vars = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // A single argv entry would go through `sh -c`; several are exec'd as-is (no shell quoting issues).
  await tmux("new-session", "-d", "-s", sessionName(panelId), "-x", "160", "-y", "48", "-c", cwd, ...vars, "--", ...argv);
  await tmux("source-file", CONF); // apply config changes to an already-running tmux server
}

export async function killSession(panelId: string): Promise<void> {
  await tmux("kill-session", "-t", sessionName(panelId)).catch(() => {}); // already gone is fine
}

/**
 * Every running panel (a panel's tmux session ends with its process), with the time its program last
 * printed output (unix seconds). tmux tracks that even when no client is attached.
 */
export async function panelActivity(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let stdout = "";
  try {
    ({ stdout } = await tmux("list-windows", "-a", "-F", "#{session_name} #{window_activity}"));
  } catch (e) {
    if (e instanceof ServiceError) throw e; // tmux missing: don't mistake that for "no panels"
    return out; // no tmux server running yet
  }
  for (const line of stdout.split("\n")) {
    const [name, time] = line.split(" ");
    if (name?.startsWith("p-")) out.set(name.slice(2), Number(time));
  }
  return out;
}

/** Ids of the panels whose process is still running. */
export async function runningPanels(): Promise<Set<string>> {
  return new Set((await panelActivity()).keys());
}

/** Attach a new tmux client in a PTY. Killing the PTY only detaches; the process keeps running. */
export function attach(panelId: string, cols: number, rows: number): IPty {
  return spawn("tmux", ["-u", "-S", SOCKET, "attach-session", "-t", sessionName(panelId)], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: RAILS_HOME,
    env: { ...cleanEnv(), TERM: "xterm-256color" },
  });
}
