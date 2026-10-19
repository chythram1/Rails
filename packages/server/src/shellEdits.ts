// Edits made by shell commands (ADR 0016). Agents report what their edit tools change, but not the files a shell
// command writes (`cat > f <<EOF`, a script): in a test run, one agent wrote everything that way, and overlaps
// couldn't see it. So when a session runs a shell command, Rails notes the project's changed files (`git status`,
// with each file's modification time and size) when it starts and again when it ends, and counts as that
// session's the files that changed in between, or were modified after it started.
// It can blur who did what: another session writing in the same seconds looks the same. Files another session
// reported changing with its edit tools meanwhile stay theirs, and commands longer than MAX_WINDOW_MS are left
// out (a test run or a server would collect everyone's edits). Projects that aren't git repositories are skipped.
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

function started(panel: Panel, id: string): void {
  const root = projects.get(panel.projectId)?.path;
  if (!root) return;
  const now = Date.now();
  for (const [k, s] of open) if (now - s.started > 10 * MAX_WINDOW_MS) open.delete(k); // ends that never came
  open.set(key(panel.id, id), { started: now - SLACK_MS, root, before: snapshot(root) });
}

async function ended(panel: Panel, id: string): Promise<void> {
  const s = open.get(key(panel.id, id));
  open.delete(key(panel.id, id));
  if (!s || Date.now() - s.started > MAX_WINDOW_MS) return;
  const [before, after] = await Promise.all([s.before, snapshot(s.root)]);
  if (!before || !after || !panels.get(panel.id)) return;
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
    if (call.phase === "start") started(panel, call.id);
    else void ended(panel, call.id).catch((e) => console.error("shell edits:", e));
  });
  onPanelForgotten((id) => {
    for (const k of open.keys()) if (k.startsWith(id + " ")) open.delete(k);
  });
}
