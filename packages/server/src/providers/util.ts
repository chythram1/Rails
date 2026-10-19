import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredSession } from "./types.ts";

const CHUNK = 64 * 1024;

/** Parsed JSON lines from the first and last ~64KB of a JSONL file (partial lines dropped). */
export async function headTail(file: string): Promise<{ head: any[]; tail: any[]; mtime: Date }> {
  const st = await stat(file);
  const fh = await open(file, "r");
  try {
    const read = async (pos: number, len: number) => {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      return buf.subarray(0, bytesRead).toString("utf8");
    };
    const headText = await read(0, Math.min(CHUNK, st.size));
    const head = parseLines(st.size > CHUNK ? headText.slice(0, headText.lastIndexOf("\n")) : headText);
    let tail = head;
    if (st.size > CHUNK) {
      const tailText = await read(Math.max(0, st.size - CHUNK), Math.min(CHUNK, st.size));
      tail = parseLines(tailText.slice(tailText.indexOf("\n") + 1));
    }
    return { head, tail, mtime: st.mtime };
  } finally {
    await fh.close();
  }
}

/** Parsed JSON lines from the last `bytes` of a JSONL file (a partial first line dropped). */
export async function tailLines(file: string, bytes = 1024 * 1024): Promise<any[]> {
  const st = await stat(file);
  const fh = await open(file, "r");
  try {
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, st.size - len);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    return parseLines(st.size > len ? text.slice(text.indexOf("\n") + 1) : text);
  } finally {
    await fh.close();
  }
}

function parseLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // partial or corrupt line: skip
    }
  }
  return out;
}

/** Recursively list files matching `pred` (missing dirs => []). */
export async function walk(dir: string, pred: (name: string) => boolean, depth = 4): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...(await walk(p, pred, depth - 1)));
    else if (e.isFile() && pred(e.name)) out.push(p);
  }
  return out;
}

/** Scan files with `scanFile`, caching each result by (mtime, size). Unreadable or unrecognized files are skipped. */
export function cachedScanner(scanFile: (file: string) => Promise<DiscoveredSession | null>) {
  const cache = new Map<string, { key: string; session: DiscoveredSession | null }>();
  const scanCached = async (file: string) => {
    const st = await stat(file);
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.session;
    const session = await scanFile(file);
    cache.set(file, { key, session });
    return session;
  };
  return async (files: string[]): Promise<DiscoveredSession[]> => {
    const out = await Promise.all(files.map((f) => scanCached(f).catch(() => null)));
    return out.filter((s): s is DiscoveredSession => !!s);
  };
}

export const firstLine = (s: string, max = 80) => {
  // Skill invocations are wrapped as <skill name="x">...</skill>; show them as "/x rest". Claude Code wraps a long
  // pasted prompt in <pasted_content id="..."> tags: the title is what's inside.
  const text = s.replace(/^\s*<skill name="([^"]+)"[\s\S]*?<\/skill>\s*/, "/$1 ").replace(/^\s*<pasted_content[^>]*>\s*/, "").replace(/\s*<\/pasted_content[^>]*>[\s\S]*$/, "");
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};
