import type { ProviderId } from "@rails/shared";

// Shared with the server, which titles sessions for agents (agentTools.ts).
export { shortTitle } from "@rails/shared";

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); // e.g. "Oct 3"
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

/** "just now", "23 minutes ago", "yesterday", "3 weeks ago": the long form, for message details. */
export function timeAgoLong(iso: string, now = Date.now()): string {
  const s = (new Date(iso).getTime() - now) / 1000;
  const unit = UNITS.find(([, size]) => Math.abs(s) >= size);
  return unit ? relative.format(Math.round(s / unit[1]), unit[0]) : "just now";
}

/**
 * Copy text to the clipboard. The async Clipboard API needs a secure context and Rails also runs over plain
 * HTTP on the LAN, so this selects the text in a hidden field and runs the copy command, then gives focus
 * back. Returns whether it worked.
 */
export function copyText(text: string): boolean {
  const before = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  before?.focus();
  return ok;
}

export const providerLabel: Record<ProviderId, string> = { claude: "Claude Code", codex: "Codex", pi: "pi" };

