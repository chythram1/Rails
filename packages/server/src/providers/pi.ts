import { existsSync } from "node:fs";
import { join } from "node:path";
import { PI_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter, TranscriptMessage } from "./types.ts";
import { cachedScanner, firstLine, headTail, walk } from "./util.ts";

const root = join(PI_HOME, "sessions");

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
      : "";

async function scanFile(file: string): Promise<DiscoveredSession | null> {
  const { head, tail, mtime } = await headTail(file);
  const s = head[0];
  if (s?.type !== "session" || !s.cwd) return null;
  // The user's /name: the latest session_info line counts, and an empty one clears it (pi 1.3). Only the head and
  // tail are read, so a name set in the middle of a long session is missed.
  let title = "";
  for (const e of [...head, ...tail]) if (e.type === "session_info") title = typeof e.name === "string" ? e.name.trim() : "";
  if (!title) {
    const u = head.find((e) => e.type === "message" && e.message?.role === "user" && textOf(e.message.content));
    title = u ? firstLine(textOf(u.message.content)) : "Untitled session";
  }
  return { provider: "pi", id: s.id, cwd: s.cwd, title, createdAt: s.timestamp, updatedAt: mtime.toISOString(), file };
}

/** User and assistant messages (tool results and extension messages are left out). */
const messages = (lines: any[]): TranscriptMessage[] =>
  lines.flatMap((e) => {
    const role = e.type !== "message" ? null : e.message?.role === "user" ? "user" : e.message?.role === "assistant" ? "agent" : null;
    const text = role ? textOf(e.message.content).trim() : "";
    return role && text ? [{ role, text, at: e.timestamp }] : [];
  });

const scanFiles = cachedScanner(scanFile);

export const piDiscovery: DiscoveryAdapter = {
  id: "pi",
  name: "pi",
  available: () => existsSync(root),
  messages,
  async scan() {
    return scanFiles(await walk(root, (n) => n.endsWith(".jsonl"), 1));
  },
};
