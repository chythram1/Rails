// Codex rollout format is implemented from public docs; untested locally (see docs/providers.md).
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter, TranscriptMessage } from "./types.ts";
import { cachedScanner, firstLine, headTail, walk } from "./util.ts";

const root = join(CODEX_HOME, "sessions");
const nameIndex = join(CODEX_HOME, "session_index.jsonl");

const textOf = (content: unknown) =>
  Array.isArray(content) ? content.map((b: any) => b?.text ?? "").join("\n") : typeof content === "string" ? content : "";

const isContextText = (t: string) => /^<(environment_context|user_instructions|permissions)/.test(t.trim());

async function scanFile(file: string): Promise<DiscoveredSession | null> {
  const { head, mtime } = await headTail(file);
  const meta = head.find((e) => e.type === "session_meta")?.payload;
  if (!meta?.cwd) return null;
  const firstUser = head
    .filter((e) => e.type === "response_item" && e.payload?.type === "message" && e.payload.role === "user")
    .map((e) => textOf(e.payload.content))
    .find((t) => t && !isContextText(t));
  return {
    provider: "codex",
    id: meta.id,
    cwd: meta.cwd,
    title: firstUser ? firstLine(firstUser) : "Untitled session",
    createdAt: meta.timestamp ?? mtime.toISOString(),
    updatedAt: mtime.toISOString(),
    file,
  };
}

/** User and assistant messages, without the context Codex adds as user messages or developer notes. */
const messages = (lines: any[]): TranscriptMessage[] =>
  lines.flatMap((e) => {
    const p = e.type === "response_item" && e.payload?.type === "message" ? e.payload : null;
    const role = p?.role === "user" ? "user" : p?.role === "assistant" ? "agent" : null;
    const text = role ? textOf(p.content).trim() : "";
    return role && text && !isContextText(text) ? [{ role, text, at: e.timestamp }] : [];
  });

const scanFiles = cachedScanner(scanFile);

/**
 * Names the user gave threads with /rename (Codex 0.163): appended to `session_index.jsonl` as
 * `{id, thread_name, updated_at}`, the latest non-empty name winning. One short line per rename, so it's read whole,
 * cached by mtime and size.
 */
let names: { key: string; byId: Map<string, string> } = { key: "", byId: new Map() };
async function threadNames(): Promise<Map<string, string>> {
  const st = await stat(nameIndex).catch(() => null);
  const key = st ? `${st.mtimeMs}:${st.size}` : "";
  if (key === names.key) return names.byId;
  const byId = new Map<string, string>();
  for (const line of st ? (await readFile(nameIndex, "utf8").catch(() => "")).split("\n") : []) {
    try {
      const e = JSON.parse(line);
      if (typeof e?.id === "string" && typeof e.thread_name === "string" && e.thread_name.trim()) byId.set(e.id, e.thread_name.trim());
    } catch {
      // a partial or corrupt line
    }
  }
  names = { key, byId };
  return byId;
}

export const codexDiscovery: DiscoveryAdapter = {
  id: "codex",
  name: "Codex",
  available: () => existsSync(root),
  messages,
  async scan() {
    const [found, named] = await Promise.all([scanFiles(await walk(root, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), 4)), threadNames()]);
    return found.map((s) => (named.has(s.id) ? { ...s, title: named.get(s.id)! } : s));
  },
};
