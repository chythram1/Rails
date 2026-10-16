import { existsSync } from "node:fs";
import { join } from "node:path";
import { PI_HOME } from "../config.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";
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
};
