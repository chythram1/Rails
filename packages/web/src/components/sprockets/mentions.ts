// Team members named in a message (ADR 0022, 0033), for the chips the chat draws.
import { findMentions } from "@rails/shared";

/**
 * Where team members are named in `text` (ADR 0033): their @mentions as the server reads them (findMentions, also the
 * start of a name: "@Doc" is Doc Keeper), and their whole names without an @, as words in any case. A name is a
 * reference: it wakes nobody.
 */
export function findNames(text: string, list: string[]): { start: number; end: number; member: number; at: boolean }[] {
  const found = findMentions(text, list).map((f) => ({ ...f, at: true }));
  const taken = (s: number, e: number) => found.some((f) => s < f.end && e > f.start);
  const byLength = list.map((name, member) => ({ name, member })).filter((n) => n.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const { name, member } of byLength) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}_@])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "giu");
    for (const m of text.matchAll(re)) if (!taken(m.index, m.index + m[0].length)) found.push({ start: m.index, end: m.index + m[0].length, member, at: false });
  }
  return found.sort((a, b) => a.start - b.start);
}
