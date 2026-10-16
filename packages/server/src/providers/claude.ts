import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { CLAUDE_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";
import { cachedScanner, firstLine, headTail, walk } from "./util.ts";

const root = join(CLAUDE_HOME, "projects");

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

const scanFiles = cachedScanner(scanFile);

export const claudeDiscovery: DiscoveryAdapter = {
  id: "claude",
  name: "Claude Code",
  available: () => existsSync(root),
  async scan() {
    // Top-level *.jsonl only; subdirectories hold subagent transcripts.
    return scanFiles(await walk(root, (n) => n.endsWith(".jsonl"), 1));
  },
};
