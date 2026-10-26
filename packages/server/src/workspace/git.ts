import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "@rails/shared";
import { ServiceError } from "../errors.ts";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 });

export async function gitStatus(cwd: string): Promise<GitStatus> {
  let stdout: string;
  try {
    ({ stdout } = await git(cwd, "status", "--porcelain=v1", "--branch", "-z"));
  } catch (e: any) {
    if (e?.code === "ENOENT") throw new ServiceError("git isn't installed, so Rails can't show changes.", 503);
    const stderr = String(e?.stderr ?? "");
    // Not a repository (or its folder is gone): nothing to show. Anything else (say, git refusing a folder another
    // user owns) is git's to explain, not a folder without git.
    if (/not a git repository|cannot change to/.test(stderr)) return { isRepo: false, ahead: 0, behind: 0, files: [] };
    throw new ServiceError(stderr.trim().split("\n")[0]?.replace(/^fatal: /, "git: ") || "git failed.", 503);
  }
  const status: GitStatus = { isRepo: true, ahead: 0, behind: 0, files: [] };
  const parts = stdout.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("## ")) {
      // "## main...origin/main [ahead 1, behind 2]" or "## No commits yet on main"
      const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(p);
      status.branch = m?.[1];
      status.upstream = m?.[2];
      status.ahead = Number(/ahead (\d+)/.exec(m?.[3] ?? "")?.[1] ?? 0);
      status.behind = Number(/behind (\d+)/.exec(m?.[3] ?? "")?.[1] ?? 0);
      continue;
    }
    const code = p.slice(0, 2);
    status.files.push({ path: p.slice(3), status: code });
    if (code[0] === "R" || code[0] === "C") i++; // skip rename source path
  }
  return status;
}

export async function gitDiff(cwd: string, path: string): Promise<string> {
  const { files } = await gitStatus(cwd);
  const f = files.find((x) => x.path === path);
  if (!f) return "";
  if (f.status === "??") {
    try {
      await git(cwd, "diff", "--no-index", "--", "/dev/null", path);
      return "";
    } catch (e: any) {
      return e.stdout ?? ""; // --no-index exits 1 when there are differences
    }
  }
  try {
    return (await git(cwd, "diff", "HEAD", "--", path)).stdout;
  } catch {
    return (await git(cwd, "diff", "--cached", "--", path)).stdout; // no HEAD yet
  }
}

/** The repository's top folder, which git's paths are relative to. */
export async function gitRoot(cwd: string): Promise<string> {
  return (await git(cwd, "rev-parse", "--show-toplevel")).stdout.trim();
}

/** Lines added and deleted per changed file since the last commit, staged or not. Untracked and binary files have none. */
export async function gitLineCounts(cwd: string): Promise<Map<string, { added: number; deleted: number }>> {
  try {
    const { stdout } = await git(cwd, "diff", "HEAD", "--numstat", "-z").catch(() => git(cwd, "diff", "--cached", "--numstat", "-z")); // no HEAD yet
    return parseNumstat(stdout);
  } catch {
    return new Map(); // the counts are extra: the list shows without them
  }
}

/** `git diff --numstat -z`: "added\tdeleted\tpath\0", or for a rename "added\tdeleted\t\0from\0to\0"; binary files say "-". */
export function parseNumstat(out: string): Map<string, { added: number; deleted: number }> {
  const counts = new Map<string, { added: number; deleted: number }>();
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const [added, deleted, path] = parts[i].split("\t");
    if (deleted === undefined) continue;
    const file = path || parts[(i += 2)]; // a rename: its new path is two parts on
    if (file && added !== "-") counts.set(file, { added: Number(added), deleted: Number(deleted) });
  }
  return counts;
}

/** A commit name or range from a script: refused if it could pass for an option. */
function revision(rev: string): string {
  if (!/^[\w./~^@{}:-]+$/.test(rev) || rev.startsWith("-")) throw new Error(`"${rev}" isn't a commit name.`);
  return rev;
}

/** Recent commits, newest first (touching `path`, if given). */
export async function gitLog(cwd: string, limit: number, path?: string): Promise<{ commit: string; date: string; author: string; subject: string }[]> {
  const { stdout } = await git(cwd, "log", `-n${Math.max(1, Math.floor(limit))}`, "--format=%h%x1f%aI%x1f%an%x1f%s", "--", ...(path ? [path] : []));
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [commit, date, author, subject] = line.split("\x1f");
      return { commit, date, author, subject };
    });
}

/** A git command's output, but no more than `maxBytes` of it: git is stopped once that much has arrived. */
function gitCapped(cwd: string, args: string[], maxBytes: number): Promise<{ text: string; cut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (cut) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= maxBytes) {
        cut = true;
        child.kill();
      }
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      // The last line may be cut mid-way: keep whole lines only.
      const text = Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
      if (cut) resolve({ text: text.slice(0, text.lastIndexOf("\n") + 1), cut });
      else if (code === 0) resolve({ text, cut });
      else reject(new Error(err.trim() || `git ${args[0]} failed`));
    });
  });
}

/** One commit: its message, the files it changed and its patch, up to `maxBytes`. */
export async function gitShow(cwd: string, commit: string, maxBytes: number): Promise<{ text: string; cut: boolean }> {
  return gitCapped(cwd, ["show", "--stat", "--patch", "--no-color", "--format=fuller", revision(commit)], maxBytes);
}

/** Uncommitted changes against HEAD, up to `maxBytes`, plus the names of untracked files. */
export async function gitDiffAll(cwd: string, maxBytes: number): Promise<{ text: string; cut: boolean; untracked: string[] }> {
  const diff = await gitCapped(cwd, ["diff", "HEAD", "--no-color"], maxBytes).catch(() => gitCapped(cwd, ["diff", "--cached", "--no-color"], maxBytes)); // no HEAD yet
  const untracked = (await gitStatus(cwd)).files.filter((f) => f.status === "??").map((f) => f.path);
  return { ...diff, untracked };
}
