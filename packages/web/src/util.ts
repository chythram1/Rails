import type { ProviderId } from "@rails/shared";

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const providerLabel: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex", pi: "pi" };

export const tildify = (p: string) => p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~");

/** Random id. Not crypto.randomUUID: that's missing on plain-http LAN/Tailscale origins (non-secure context). */
export const randomId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
