// Codex rollout format is implemented from public docs; untested locally (see docs/providers.md).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "@rails/shared";
import { CODEX_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";
import { cachedScanner, firstLine, headTail, readJsonl, stringifyOutput, walk } from "./util.ts";

const root = join(CODEX_HOME, "sessions");

const textOf = (content: unknown) =>
  Array.isArray(content) ? content.map((b: any) => b?.text ?? "").join("\n") : typeof content === "string" ? content : "";

const isContextText = (t: string) => /^<(environment_context|user_instructions|permissions)/.test(t.trim());

function normalize(e: any, idx: number): Message[] {
  if (e.type !== "response_item") return [];
  const p = e.payload ?? {};
  const id = p.id ?? `codex-${idx}`;
  const ts = e.timestamp;
  if (p.type === "message") {
    const text = textOf(p.content);
    if (!text || isContextText(text)) return [];
    if (p.role === "user") return [{ kind: "user", id, text, ts }];
    if (p.role === "assistant") return [{ kind: "assistant", id, text, ts }];
    return [];
  }
  if (p.type === "reasoning") {
    const text = textOf(p.summary);
    return text ? [{ kind: "thinking", id, text, ts }] : [];
  }
  if (p.type === "function_call" || p.type === "custom_tool_call") {
    let input: unknown = p.arguments ?? p.input;
    try {
      input = typeof input === "string" ? JSON.parse(input) : input;
    } catch {}
    return [{ kind: "tool_use", id, toolUseId: p.call_id, name: p.name, input, ts }];
  }
  if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
    const out = typeof p.output === "string" ? p.output : (p.output?.content ?? stringifyOutput(p.output));
    return [{ kind: "tool_result", id, toolUseId: p.call_id, output: out, isError: false, ts }];
  }
  return [];
}

async function scanFile(file: string): Promise<DiscoveredSession | null> {
  const { head, mtime } = await headTail(file);
  const meta = head.find((e) => e.type === "session_meta")?.payload;
  if (!meta?.cwd) return null;
  const u = head.flatMap(normalize).find((m) => m.kind === "user");
  return {
    provider: "codex",
    id: meta.id,
    cwd: meta.cwd,
    file,
    title: u?.kind === "user" ? firstLine(u.text) : "Untitled session",
    createdAt: meta.timestamp ?? mtime.toISOString(),
    updatedAt: mtime.toISOString(),
  };
}

const scanFiles = cachedScanner(scanFile);

export const codexDiscovery: DiscoveryAdapter = {
  id: "codex",
  name: "Codex",
  available: () => existsSync(root),
  async scan() {
    return scanFiles(await walk(root, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl"), 4));
  },
  async readTranscript(file) {
    return (await readJsonl(file)).flatMap(normalize);
  },
};
