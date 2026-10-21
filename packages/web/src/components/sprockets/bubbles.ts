// A Sprocket's reply as chat bubbles: it writes like a person texting (runs.ts), one thought per paragraph, and
// each paragraph shows as its own bubble, appearing one after another.

const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s/;
const FENCE = /^\s*(```|~~~)/;

/** A plain paragraph longer than this is split between sentences (models write longer ones than they're asked to). */
const LONG = 320;
/** About how much of it goes in each bubble then. */
const SHARE = 260;

/** A long plain paragraph as a few bubbles, whole sentences each. Lists, code and short paragraphs stay as they are. */
function sentences(part: string): string[] {
  if (part.length <= LONG || part.includes("\n")) return [part];
  const out: string[] = [];
  let cur = "";
  for (const sentence of part.match(/[^.!?]+(?:[.!?]+["”’)\]]*\s*|$)/g) ?? [part]) {
    if (cur && cur.length + sentence.length > SHARE) {
      out.push(cur.trim());
      cur = "";
    }
    cur += sentence;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * The bubbles of a reply: its paragraphs (split at blank lines; a long one between sentences), except that a code
 * block is never split, a paragraph that ends with ":" stays with what it introduces, and a list stays in one bubble.
 */
export function bubbles(text: string): string[] {
  const parts: string[] = [];
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    const part = lines.join("\n").trim();
    if (part) parts.push(part);
    lines = [];
  };
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    if (!fenced && !line.trim()) flush();
    else lines.push(line);
  }
  flush();
  const out: string[] = [];
  for (const part of parts) {
    const prev = out.at(-1);
    if (prev !== undefined && (/:\s*$/.test(prev) || (LIST_ITEM.test(part) && LIST_ITEM.test(prev.split("\n").at(-1)!)))) out[out.length - 1] = `${prev}\n${part}`;
    else out.push(part);
  }
  return out.length ? out.flatMap(sentences) : [text];
}

/** How long the next bubble takes to "type" (ms): a little per character, within bounds. */
export const typingTime = (next: string) => Math.min(1400, 350 + next.length * 8);
