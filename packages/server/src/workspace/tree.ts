// The file tree beside a workspace (the side panel's Files tab): one folder at a time, each entry with its git
// state, and a read-only preview of a file. Inside the project only (links resolved first), git's own folder left
// out, and files that usually hold secrets listed but never shown (the same policy as Sprockets' reads, files.ts).
import { execFile } from "node:child_process";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";
import type { FileEntry, FolderListing, GitState } from "@rails/shared";
import { ServiceError } from "../errors.ts";
import { ignoredAmong, isSecretPath } from "./files.ts";

const run = promisify(execFile);

/** Entries one listing looks at: a folder with more says so. */
const LIST_MAX = 1000;
/** The most of a file a preview shows. */
const PREVIEW_MAX_BYTES = 256 * 1024;
/** How long one `git status` serves the listings of a project (opening a few folders at once runs it once). */
const STATUS_TTL_MS = 1500;

/** `path` (relative to the project) resolved through links, or an error if it's outside. */
async function inside(root: string, path: string): Promise<{ abs: string; rel: string }> {
  let abs: string;
  try {
    abs = await realpath(join(root, path));
  } catch {
    throw new ServiceError(`There's no ${path} in the project.`, 404);
  }
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new ServiceError(`${path} is outside the project.`, 400);
  return { abs, rel };
}

/** What a porcelain XY code means for the tree. */
function stateOf(xy: string): GitState {
  if (xy === "??") return "untracked";
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "conflict";
  if (xy.includes("D")) return "deleted";
  if (xy[0] === "A") return "added";
  if (xy[0] === "R" || xy[0] === "C") return "renamed";
  return "modified";
}

/** Which state a folder shows when it holds several: the one that most needs a look. */
const RANK: Record<GitState, number> = { conflict: 5, deleted: 4, modified: 3, renamed: 2, added: 1, untracked: 0 };

type Status = { isRepo: boolean; states: Map<string, GitState> };
const statusCache = new Map<string, { at: number; status: Promise<Status> }>();

/** Every changed file's state, by its path in the project (which may be a folder inside a repository). */
function projectStatus(root: string): Promise<Status> {
  const hit = statusCache.get(root);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const status = (async (): Promise<Status> => {
    let prefix: string;
    let out: string;
    try {
      prefix = (await run("git", ["-C", root, "rev-parse", "--show-prefix"])).stdout.trim();
      out = (await run("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { maxBuffer: 32 * 1024 * 1024 })).stdout;
    } catch {
      return { isRepo: false, states: new Map() };
    }
    const states = new Map<string, GitState>();
    const parts = out.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      const xy = p.slice(0, 2);
      if (xy[0] === "R" || xy[0] === "C") i++; // the rename's source path follows
      const path = p.slice(3);
      if (path.startsWith(prefix)) states.set(path.slice(prefix.length), stateOf(xy));
    }
    return { isRepo: true, states };
  })();
  statusCache.set(root, { at: Date.now(), status });
  return status;
}

/**
 * A folder's entries (folders first, then files, by name), each with its git state (a folder takes the strongest
 * of what it holds) and whether git ignores it, plus the files git has as deleted there (gone from the disk).
 */
export async function listFolder(root: string, path: string): Promise<FolderListing> {
  const { abs, rel } = path ? await inside(root, path) : { abs: root, rel: "" };
  if (!(await stat(abs)).isDirectory()) throw new ServiceError(`${rel} isn't a folder.`, 400);
  const found: FileEntry[] = [];
  let more = false;
  for await (const e of await opendir(abs)) {
    if (found.length >= LIST_MAX) {
      more = true;
      break;
    }
    if (e.name === ".git") continue;
    found.push({ name: e.name, path: rel ? `${rel}/${e.name}` : e.name, dir: e.isDirectory() });
  }
  const [{ isRepo, states }, ignored] = await Promise.all([
    projectStatus(root),
    ignoredAmong(root, found.map((e) => (e.dir ? `${e.path}/` : e.path))),
  ]);
  for (const e of found) {
    if (ignored.has(e.dir ? `${e.path}/` : e.path)) e.ignored = true;
    if (!e.dir) {
      const s = states.get(e.path);
      if (s && s !== "deleted") e.git = s;
      continue;
    }
    let strongest: GitState | undefined;
    for (const [p, s] of states) if (p.startsWith(`${e.path}/`) && (!strongest || RANK[s] > RANK[strongest])) strongest = s;
    if (strongest) e.git = strongest;
  }
  const deleted = [...states].filter(([p, s]) => s === "deleted" && p.slice(0, p.lastIndexOf("/") + 1) === (rel ? `${rel}/` : "")).map(([p]) => p);
  const byName = (a: FileEntry, b: FileEntry) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }) : a.dir ? -1 : 1);
  return { path: rel, entries: found.sort(byName), more, isRepo, deleted };
}

/** A file's text for the preview: up to PREVIEW_MAX_BYTES, `cut` when there's more. Not secrets, binaries or folders. */
export async function previewFile(root: string, path: string): Promise<{ text: string; cut: boolean }> {
  const { abs, rel } = await inside(root, path);
  if (isSecretPath(rel)) throw new ServiceError(`${rel} may hold secrets, so Rails doesn't show it here. Open it in a shell panel if you need it.`, 400);
  const info = await stat(abs);
  if (info.isDirectory()) throw new ServiceError(`${rel} is a folder.`, 400);
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(info.size, PREVIEW_MAX_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, Math.min(bytesRead, 8192)).includes(0)) throw new ServiceError(`${rel} is a binary file.`, 400);
    const cut = info.size > PREVIEW_MAX_BYTES;
    let text = buf.subarray(0, bytesRead).toString("utf8");
    if (cut) text = text.slice(0, text.lastIndexOf("\n") + 1); // whole lines only
    return { text, cut };
  } finally {
    await fh.close();
  }
}
