import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Message } from "@rails/shared";
import { CLAUDE_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";
import { fileCache, firstLine, headTail, readJsonl, stringifyOutput, walk } from "./util.ts";

const root = join(CLAUDE_HOME, "projects");
const cache = fileCache<DiscoveredSession | null>();

/** Text of a user entry, or null if it's a tool_result / meta entry. */
function userText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.filter((b: any) => b?.type === "text").map((b: any) => b.text);
    return t.length ? t.join("\n") : null;
  }
  return null;
}

const isMetaText = (t: string) => /^<(command-|local-command|system-reminder)/.test(t.trim());

/**
 * Normalize one Claude entry. Works for both transcript lines and live SDK messages,
 * since both have the shape { type, uuid, message: { content } }.
 */
export function normalizeClaude(e: any): Message[] {
  if ((e.type !== "user" && e.type !== "assistant") || e.isSidechain || e.isMeta) return [];
  const content = e.message?.content;
  const id = e.uuid ?? e.message?.id ?? crypto.randomUUID();
  const ts = e.timestamp;
  if (e.type === "user") {
    const text = userText(content);
    if (text !== null) return isMetaText(text) ? [] : [{ kind: "user", id, text, ts }];
    return (content as any[])
      .filter((b) => b?.type === "tool_result")
      .map((b, i) => ({
        kind: "tool_result" as const,
        id: `${id}:${i}`,
        toolUseId: b.tool_use_id,
        output: stringifyOutput(b.content),
        isError: !!b.is_error,
        ts,
      }));
  }
  const out: Message[] = [];
  (Array.isArray(content) ? content : []).forEach((b: any, i: number) => {
    const bid = `${id}:${i}`;
    if (b.type === "text" && b.text) out.push({ kind: "assistant", id: bid, text: b.text, ts });
    else if (b.type === "thinking" && b.thinking) out.push({ kind: "thinking", id: bid, text: b.thinking, ts });
    else if (b.type === "tool_use") out.push({ kind: "tool_use", id: bid, toolUseId: b.id, name: b.name, input: b.input, ts });
  });
  return out;
}

async function scanFile(file: string): Promise<DiscoveredSession | null> {
  const { head, tail, mtime } = await headTail(file);
  const first = head.find((e) => e.cwd && e.sessionId);
  if (!first) return null;
  let title = "";
  for (const e of [...head, ...tail]) {
    if (e.type === "custom-title" && e.customTitle) title = e.customTitle;
    else if (e.type === "summary" && e.summary && !title) title = e.summary;
  }
  if (!title) {
    const u = head.find((e) => e.type === "user" && !e.isSidechain && !e.isMeta && userText(e.message?.content) && !isMetaText(userText(e.message.content)!));
    title = u ? firstLine(userText(u.message.content)!) : "Untitled session";
  }
  return {
    provider: "claude",
    id: first.sessionId ?? basename(file, ".jsonl"),
    cwd: first.cwd,
    file,
    title,
    createdAt: first.timestamp ?? mtime.toISOString(),
    updatedAt: mtime.toISOString(),
  };
}

export const claudeDiscovery: DiscoveryAdapter = {
  id: "claude",
  name: "Claude Code",
  available: () => existsSync(root),
  async scan() {
    // Top-level *.jsonl only; subdirectories hold subagent transcripts.
    const files = await walk(root, (n) => n.endsWith(".jsonl"), 1);
    const out = await Promise.all(files.map((f) => cache(f, () => scanFile(f)).catch(() => null)));
    return out.filter((s): s is DiscoveredSession => !!s);
  },
  async readTranscript(file) {
    return (await readJsonl(file)).flatMap(normalizeClaude);
  },
};
