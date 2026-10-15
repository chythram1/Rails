import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "@rails/shared";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 });

export async function gitStatus(cwd: string): Promise<GitStatus> {
  let stdout: string;
  try {
    ({ stdout } = await git(cwd, "status", "--porcelain=v1", "--branch", "-z"));
  } catch {
    return { isRepo: false, ahead: 0, behind: 0, files: [] };
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
