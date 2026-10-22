// Edits made by shell commands (ADR 0016). Agents report what their edit tools change, but not the files a shell
// command writes (`cat > f <<EOF`, a script): in a test run, one agent wrote everything that way, and overlaps
// couldn't see it. So when a session runs a shell command, Rails notes the project's changed files (`git status`,
// with each file's modification time and size) when it starts and again when it ends, and counts as that
// session's the files that changed in between, or were modified after it started.
// It can blur who did what: another session writing in the same seconds looks the same. So a command that only
// reads (`cat`, `rg`, `git diff`, `node --test`…, by its command line) counts nothing: in a test run a Codex that
// was only reading took the blame for Claude Code's edit. Files another session reported changing with its edit
// tools meanwhile stay theirs (looked up a moment after the command ends, as those reports can come in late), and
// commands longer than MAX_WINDOW_MS are left out (a test run or a server would collect everyone's edits).
// Projects that aren't git repositories are skipped.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Panel } from "@rails/shared";
import { MAX_FILES } from "./bridge/events.ts";
import { cardOf, onPanelForgotten, onShellCall, record } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";

/** Longest command whose changes count: longer ones would collect other sessions' edits too. */
export const MAX_WINDOW_MS = 60_000;
/** Most changed files a snapshot looks at (a huge dirty tree isn't worth it). */
const MAX_LISTED = 2000;
/** The start is noted when Rails hears of it, a moment after the command began. */
const SLACK_MS = 1_000;
/** How long after a command ends Rails waits for other sessions' late edit reports. */
export const LATE_REPORT_MS = 1_500;

const READERS = new Set(["cat", "nl", "head", "tail", "less", "more", "wc", "ls", "rg", "grep", "egrep", "fgrep", "echo", "printf", "pwd", "cd", "stat", "file", "tree", "du", "which", "type", "true", "test", "[", "uniq", "cut", "diff", "cmp", "jq", "basename", "dirname", "realpath", "date", "awk"]);
const GIT_READS = new Set(["status", "diff", "log", "show", "ls-files", "blame", "rev-parse", "grep", "describe"]);

/**
 * Whether a command line only reads: every command in it is one that doesn't write files, and nothing is redirected
 * to a file. Anything it can't tell (a heredoc, a subshell, a script, quoting it can't follow) counts as writing.
 */
export function readsOnly(command: string | undefined): boolean {
  if (!command) return false;
  let c = command.trim();
  const wrapped = c.match(/^(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/); // Codex's /bin/zsh -lc '…'
  if (wrapped) c = wrapped[2];
  if (/<<|\$\(|`/.test(c)) return false;
  c = c.replace(/\d?>>?\s*\/dev\/null|\d?>&\d/g, "");
  if (c.includes(">")) return false;
  return c.split(/&&|\|\||[;|\n]/).every((segment) => {
    const words = segment.trim().split(/\s+/).filter((w) => w && !/^\w+=/.test(w));
    if (!words.length) return true;
    const [cmd, ...args] = words;
    const name = cmd.split("/").pop()!;
    if (name === "sed") return !args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"));
    if (name === "find") return !args.some((a) => /^-(delete|exec|execdir|ok|fprint)/.test(a));
    if (name === "sort") return !args.some((a) => a.startsWith("-o"));
    if (name === "git") return GIT_READS.has(args.find((a) => !a.startsWith("-")) ?? "");
    if (name === "node") return args.includes("--check") || args.includes("-c") || args.includes("--test");
    return READERS.has(name);
  });
}

/** Each changed file's "mtime:size" ("" when it's gone), by absolute path. */
export type Snapshot = Map<string, string>;

/** Paths from `git status --porcelain=v1 -z`: "XY path", and for renames and copies the old path after it. */
export function porcelainPaths(out: string): string[] {
  const parts = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    paths.push(parts[i].slice(3));
    if (parts[i][0] === "R" || parts[i][0] === "C") paths.push(parts[++i] ?? "");
  }
  return paths.filter(Boolean);
}

/** The project's changed files now, or nothing when it isn't a git repository. */
export async function snapshot(root: string): Promise<Snapshot | undefined> {
  const out = await new Promise<string | undefined>((done) =>
    execFile("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, timeout: 5_000, maxBuffer: 8 << 20 }, (err, stdout) =>
      done(err ? undefined : stdout),
    ),
  );
  if (out === undefined) return undefined;
  const snap: Snapshot = new Map();
  await Promise.all(
    porcelainPaths(out)
      .slice(0, MAX_LISTED)
      .map(async (p) => {
        const abs = join(root, p);
        const s = await stat(abs).catch(() => undefined);
        snap.set(abs, s ? `${s.mtimeMs}:${s.size}` : "");
      }),
  );
  return snap;
}

/** Files that changed between two snapshots, or were modified after `since` (the start may have been late). */
export function changedFiles(before: Snapshot, after: Snapshot, since: number): string[] {
  const out = new Set<string>();
  for (const [p, sig] of after) if (before.get(p) !== sig || (sig && Number(sig.split(":")[0]) >= since)) out.add(p);
  for (const p of before.keys()) if (!after.has(p)) out.add(p); // clean again: reverted, or committed
  return [...out];
}

const open = new Map<string, { started: number; root: string; before: Promise<Snapshot | undefined> }>();
const key = (panelId: string, id: string) => `${panelId} ${id}`;

function started(panel: Panel, id: string, command?: string): void {
  const root = projects.get(panel.projectId)?.path;
  if (!root || readsOnly(command)) return;
  const now = Date.now();
  for (const [k, s] of open) if (now - s.started > 10 * MAX_WINDOW_MS) open.delete(k); // ends that never came
  open.set(key(panel.id, id), { started: now - SLACK_MS, root, before: snapshot(root) });
}

async function ended(panel: Panel, id: string): Promise<void> {
  const s = open.get(key(panel.id, id));
  open.delete(key(panel.id, id));
  if (!s || Date.now() - s.started > MAX_WINDOW_MS) return;
  const [before, after] = await Promise.all([s.before, snapshot(s.root)]);
  if (!before || !after) return;
  await new Promise((r) => setTimeout(r, LATE_REPORT_MS));
  if (!panels.get(panel.id)) return;
  // What other sessions reported changing with their edit tools meanwhile is theirs.
  const theirs = new Set(
    panels
      .list(panel.projectId)
      .filter((p) => p.id !== panel.id)
      .flatMap((p) => cardOf(p).edits.filter((e) => Date.parse(e.at) >= s.started).map((e) => e.file)),
  );
  const files = changedFiles(before, after, s.started).filter((f) => !theirs.has(f));
  if (files.length) record(panel.id, [{ kind: "tool", tool: "shell", files: files.slice(0, MAX_FILES), edit: true }]);
}

/** Follow every session's shell commands. */
export function startShellEdits(): void {
  onShellCall((panel, call) => {
    if (call.phase === "start") started(panel, call.id, call.command);
    else void ended(panel, call.id).catch((e) => console.error("shell edits:", e));
  });
  onPanelForgotten((id) => {
    for (const k of open.keys()) if (k.startsWith(id + " ")) open.delete(k);
  });
}
