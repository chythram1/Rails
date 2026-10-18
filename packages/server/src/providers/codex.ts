// Codex rollout format is implemented from public docs; untested locally (see docs/providers.md).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CODEX_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter, TranscriptMessage } from "./types.ts";
import { cachedScanner, firstLine, headTail, walk } from "./util.ts";

const root = join(CODEX_HOME, "sessions");

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

export const codexDiscovery: DiscoveryAdapter = {
  id: "codex",
  name: "Codex",
  available: () => existsSync(root),
  messages,
  async scan() {
    return scanFiles(await walk(root, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), 4));
  },
};
