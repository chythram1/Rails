import { open, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveredSession } from "./types.ts";

const CHUNK = 64 * 1024;

/** Parsed JSON lines from the first and last ~64KB of a JSONL file (partial lines dropped). */
export async function headTail(file: string): Promise<{ head: any[]; tail: any[]; size: number; mtime: Date }> {
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
    return { head, tail, size: st.size, mtime: st.mtime };
  } finally {
    await fh.close();
  }
}

export function parseLines(text: string): any[] {
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

export async function readJsonl(file: string): Promise<any[]> {
  return parseLines(await readFile(file, "utf8"));
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

/** Memoize per-file scan results by (mtime, size). */
export function fileCache<T>() {
  const cache = new Map<string, { key: string; value: T }>();
  return async (file: string, compute: () => Promise<T>): Promise<T> => {
    const st = await stat(file);
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = cache.get(file);
    if (hit?.key === key) return hit.value;
    const value = await compute();
    cache.set(file, { key, value });
    return value;
  };
}

/** Scan files with `scanFile`, caching each result by (mtime, size). Unreadable or unrecognized files are skipped. */
export function cachedScanner(scanFile: (file: string) => Promise<DiscoveredSession | null>) {
  const cache = fileCache<DiscoveredSession | null>();
  return async (files: string[]): Promise<DiscoveredSession[]> => {
    const out = await Promise.all(files.map((f) => cache(f, () => scanFile(f)).catch(() => null)));
    return out.filter((s): s is DiscoveredSession => !!s);
  };
}

export const firstLine = (s: string, max = 80) => {
  // Skill invocations are wrapped as <skill name="x">...</skill>; show them as "/x rest".
  const text = s.replace(/^\s*<skill name="([^"]+)"[\s\S]*?<\/skill>\s*/, "/$1 ");
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

export function stringifyOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((b: any) => (b?.type === "text" ? b.text : b?.type ? `[${b.type}]` : String(b))).join("\n");
  return content == null ? "" : JSON.stringify(content);
}
