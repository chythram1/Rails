import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@rails/shared";
import { PI_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";
import { cachedScanner, firstLine, headTail, readJsonl, stringifyOutput, walk } from "./util.ts";

const root = join(PI_HOME, "sessions");

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n")
      : "";

function normalize(e: any): Message[] {
  if (e.type !== "message") return [];
  const m = e.message ?? {};
  const id = e.id;
  const ts = e.timestamp;
  switch (m.role) {
    case "user": {
      const text = textOf(m.content);
      return text ? [{ kind: "user", id, text, ts }] : [];
    }
    case "assistant": {
      const out: Message[] = [];
      (Array.isArray(m.content) ? m.content : []).forEach((b: any, i: number) => {
        const bid = `${id}:${i}`;
        if (b.type === "text" && b.text) out.push({ kind: "assistant", id: bid, text: b.text, ts });
        else if (b.type === "thinking" && b.thinking) out.push({ kind: "thinking", id: bid, text: b.thinking, ts });
        else if (b.type === "toolCall") out.push({ kind: "tool_use", id: bid, toolUseId: b.id, name: b.name, input: b.arguments, ts });
      });
      if (m.errorMessage) out.push({ kind: "system", id: `${id}:err`, text: m.errorMessage, ts });
      return out;
    }
    case "toolResult":
      return [{ kind: "tool_result", id, toolUseId: m.toolCallId, output: stringifyOutput(m.content), isError: !!m.isError, ts }];
    default:
      return [];
  }
}

async function scanFile(file: string): Promise<DiscoveredSession | null> {
  const { head, tail, mtime } = await headTail(file);
  const s = head[0];
  if (s?.type !== "session" || !s.cwd) return null;
  let title = "";
  for (const e of [...head, ...tail]) if (e.type === "session_info" && e.name) title = e.name;
  if (!title) {
    const u = head.find((e) => e.type === "message" && e.message?.role === "user" && textOf(e.message.content));
    title = u ? firstLine(textOf(u.message.content)) : "Untitled session";
  }
  return { provider: "pi", id: s.id, cwd: s.cwd, file, title, createdAt: s.timestamp, updatedAt: mtime.toISOString() };
}

const scanFiles = cachedScanner(scanFile);

export const piDiscovery: DiscoveryAdapter = {
  id: "pi",
  name: "pi",
  available: () => existsSync(root),
  async scan() {
    return scanFiles(await walk(root, (n) => n.endsWith(".jsonl"), 1));
  },
  async readTranscript(file) {
    return (await readJsonl(file)).flatMap(normalize);
  },
};
