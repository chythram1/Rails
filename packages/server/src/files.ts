// Read-only access to a project's files, for Sprockets (ADR 0008): inside the project only (symlinks
// resolved first), files git ignores or that usually hold secrets refused, and every result capped.
import { execFile, spawn } from "node:child_process";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Lines one read returns at most, and the most it reads of a file. */
export const READ_MAX_LINES = 2000;
const READ_MAX_BYTES = 1024 * 1024;
const DIR_MAX_ENTRIES = 300;
/** Entries a listing looks at, so a folder with millions of files can't exhaust memory. */
const DIR_SCAN_MAX = 1000;
export const SEARCH_MAX_MATCHES = 200;
const MATCH_MAX_CHARS = 300;

/** Files that usually hold secrets, by name (`.env.example` and the like are fine). */
const SECRET_NAME = /^(\.env(?!\.(example|sample|template|dist)$)(\..+)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials\.json|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?)$/i;
const SECRET_EXT = /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i;
/** Folders that hold secrets, and git's own (its history is read through the git capabilities). */
const SECRET_DIR = /(^|\/)(\.git|\.ssh|\.aws|\.gnupg)(\/|$)/;
/** The one secret policy: reads, listings, searches and patches all use it. */
export const isSecretPath = (rel: string) => SECRET_DIR.test(rel) || SECRET_NAME.test(basename(rel)) || SECRET_EXT.test(rel);

/**
 * A git patch (a diff, or a commit from `git show`) without the sections of files that may hold secrets. A
 * section whose header can't be read is left out too.
 */
export function withoutSecrets(patch: string): string {
  return patch
    .split(/(?=^diff --git )/m)
    .map((section) => {
      if (!section.startsWith("diff --git ")) return section;
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/m.exec(section);
      if (m && !isSecretPath(m[1]) && !isSecretPath(m[2])) return section;
      return `[Changes to ${m ? m[2] : "a file"} left out: it may hold secrets.]\n`;
    })
    .join("");
}

/** `path` (relative to the project, or absolute inside it) resolved through symlinks, or an error. */
async function inside(root: string, path: string): Promise<{ abs: string; rel: string }> {
  let abs: string;
  try {
    abs = await realpath(isAbsolute(path) ? path : join(root, path));
  } catch {
    throw new Error(`There's no ${path} in the project.`);
  }
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${path} is outside the project.`);
  if (isSecretPath(rel)) throw new Error(`${rel} may hold secrets, so Sprockets can't read it.`);
  return { abs, rel };
}

/** Which of `paths` git ignores, in one call (none outside a repository). */
export function ignoredAmong(root: string, paths: string[]): Promise<Set<string>> {
  if (!paths.length) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", root, "check-ignore", "--stdin"], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    // Exit 1: none ignored; 128: not a repository. Either way, only what it printed counts.
    child.on("close", () => resolve(new Set(out.split("\n").filter(Boolean))));
    child.on("error", () => resolve(new Set()));
    child.stdin.end(paths.join("\n") + "\n");
  });
}
const ignored = async (root: string, rel: string) => !!rel && (await ignoredAmong(root, [rel])).has(rel);

/**
 * A file's text, `lines` lines from line `from` (1-based), with a note when that isn't all of it; or, for a
 * folder, its entries (folders end with `/`).
 */
export async function readProjectFile(root: string, path: string, { from = 1, lines = 400 }: { from?: number; lines?: number } = {}): Promise<string> {
  const { abs, rel } = await inside(root, path);
  if (await ignored(root, rel)) throw new Error(`${rel} is ignored by git (generated or private files), so Sprockets don't read it.`);
  if ((await stat(abs)).isDirectory()) return listFolder(root, abs, rel);
  const fh = await open(abs, "r");
  let text: string;
  let partial = false;
  try {
    const buf = Buffer.alloc(Math.min((await fh.stat()).size, READ_MAX_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, Math.min(bytesRead, 8192)).includes(0)) throw new Error(`${rel} is a binary file.`);
    text = buf.subarray(0, bytesRead).toString("utf8");
    partial = (await fh.stat()).size > READ_MAX_BYTES;
  } finally {
    await fh.close();
  }
  const all = text.split("\n");
  if (partial) all.pop(); // a line cut off by the byte limit
  const start = Math.max(1, Math.floor(from));
  const count = Math.max(1, Math.min(Math.floor(lines), READ_MAX_LINES));
  const shown = all.slice(start - 1, start - 1 + count);
  const end = start - 1 + shown.length;
  if (start === 1 && end === all.length && !partial) return text;
  const total = partial ? `at least ${all.length}` : `${all.length}`;
  return `${shown.join("\n")}\n[Lines ${start}–${end} of ${total} in ${rel}.${end < all.length ? ` Read on with { from: ${end + 1} }.` : ""}]`;
}

async function listFolder(root: string, abs: string, rel: string): Promise<string> {
  const entries: { path: string; name: string }[] = [];
  let more = false;
  for await (const e of await opendir(abs)) {
    if (entries.length >= DIR_SCAN_MAX) {
      more = true;
      break;
    }
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (!isSecretPath(path)) entries.push({ path, name: e.isDirectory() ? `${e.name}/` : e.name });
  }
  const ignoredPaths = await ignoredAmong(root, entries.map((e) => e.path));
  const names = entries.filter((e) => !ignoredPaths.has(e.path)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  more ||= names.length > DIR_MAX_ENTRIES;
  return `${rel || "."}/ (${more ? `the first ${Math.min(names.length, DIR_MAX_ENTRIES)} of many` : names.length} entries)\n${names.slice(0, DIR_MAX_ENTRIES).join("\n")}`;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

/**
 * Lines that contain `query` (a regular expression with `regex`), git-ignored files left out: ripgrep when
 * it's installed, else `git grep` (tracked files only).
 */
export async function searchProject(
  root: string,
  query: string,
  { glob, limit = 50, regex = false }: { glob?: string; limit?: number; regex?: boolean } = {},
): Promise<{ matches: SearchMatch[]; truncated: boolean }> {
  const max = Math.max(1, Math.min(Math.floor(limit), SEARCH_MAX_MATCHES));
  let stdout = "";
  try {
    // --hidden searches config dotfiles (.github/, .eslintrc) like git grep does; secrets are filtered below.
    const args = ["--hidden", "-g", "!.git", "--line-number", "--no-heading", "--color", "never", "--max-columns", String(MATCH_MAX_CHARS), "--max-count", "50"];
    ({ stdout } = await run("rg", [...args, ...(regex ? [] : ["-F"]), ...(glob ? ["-g", glob] : []), "-e", query, "--", "."], { cwd: root, maxBuffer: 8 * 1024 * 1024 }));
  } catch (e: any) {
    if (e.code === 1) return { matches: [], truncated: false }; // no matches
    if (e.code !== "ENOENT") throw new Error(`Search failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    // Perl-style regexes like ripgrep's (\d, \b), unless this git was built without PCRE.
    const grep = (mode: string) => run("git", ["-C", root, "grep", "-n", "-I", "--no-color", mode, "-e", query, "--", ...(glob ? [glob] : [])], { maxBuffer: 8 * 1024 * 1024 });
    try {
      ({ stdout } = await grep(regex ? "-P" : "-F").catch((e) => (regex && /perl|pcre/i.test(String(e.stderr)) ? grep("-E") : Promise.reject(e))));
    } catch (e: any) {
      if (e.code === 1) return { matches: [], truncated: false };
      throw new Error("Searching needs ripgrep (rg) or a git repository.");
    }
  }
  const matches: SearchMatch[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^(.*?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const path = m[1].replace(/^\.\//, "");
    if (isSecretPath(path)) continue;
    matches.push({ path, line: Number(m[2]), text: m[3].length > MATCH_MAX_CHARS ? m[3].slice(0, MATCH_MAX_CHARS) + "…" : m[3] });
  }
  return { matches: matches.slice(0, max), truncated: matches.length > max };
}
