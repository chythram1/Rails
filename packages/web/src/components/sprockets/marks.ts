// The little Markdown Sprockets write in their replies, read for chat bubbles: fenced code blocks, `code` and
// **bold**. Nothing else is read (no links, headings, tables or HTML): the rest stays as it was typed. Only text
// comes out, which SprocketChat draws as React elements, so a reply can't inject markup.

export type Mark = { kind: "text" | "code" | "strong"; text: string };
export type Block = { kind: "text"; marks: Mark[] } | { kind: "fence"; lang: string; code: string };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
/** `code` (not across lines), or **bold** that starts and ends next to its words. */
const INLINE = /`([^`\n]+)`|\*\*(?=\S)([^*\n]*?\S)\*\*/g;

/** A line's (or a paragraph's) `code` and **bold**, between plain text. */
export function inline(text: string): Mark[] {
  const out: Mark[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: "code", text: m[1] } : { kind: "strong", text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

/** A bubble's text as blocks: fenced code (an unclosed fence runs to the end), and text with its inline marks. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let prose: string[] = [];
  let code: string[] | undefined;
  let lang = "";
  const flushProse = () => {
    const t = prose.join("\n").replace(/^\n+|\n+$/g, "");
    if (t) out.push({ kind: "text", marks: inline(t) });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const fence = line.match(FENCE);
    if (code) {
      if (fence && !fence[2]) {
        out.push({ kind: "fence", lang, code: code.join("\n") });
        code = undefined;
      } else code.push(line);
    } else if (fence) {
      flushProse();
      code = [];
      lang = fence[2];
    } else prose.push(line);
  }
  if (code) out.push({ kind: "fence", lang, code: code.join("\n") });
  flushProse();
  return out;
}

/** A reply on one line, its marks dropped (the Sprockets list's preview). */
export function plain(text: string): string {
  return blocks(text)
    .map((b) => (b.kind === "fence" ? b.code : b.marks.map((m) => m.text).join("")))
    .join(" ");
}
