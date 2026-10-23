// How a tool call's arguments read on a card (ADR 0031), apart from React so it can be tested.

/**
 * An argument's value to read: text as it is (its line breaks kept), a number or yes/no as written, and objects and
 * lists indented one key or item per line ("title: Ideas", "- …"), as real tools' arguments nest (Notion's pages).
 */
/** An id, a hash or a key: a long run of letters, digits and dashes with no space. Nothing to read. */
const idLike = (s: string) => /^[A-Za-z0-9_-]{16,}$/.test(s) && /\d/.test(s);

/**
 * A line that tells a call apart from others of the same tool: its first text that reads as words (nested arguments
 * included, as Notion's `properties.title`), else its first that isn't an id ("update_properties").
 */
export function gist(v: unknown): string | undefined {
  const all: string[] = [];
  const walk = (x: unknown, depth: number) => {
    if (typeof x === "string") {
      const line = x.trim().split("\n")[0].trim();
      if (line && !idLike(line)) all.push(line);
    } else if (x !== null && typeof x === "object" && depth < 5) for (const value of Array.isArray(x) ? x : Object.values(x)) walk(value, depth + 1);
  };
  walk(v, 0);
  return all.find((s) => /[^A-Za-z0-9_-]/.test(s)) ?? all[0];
}

/** What a call returned, to read: JSON laid out as `readable` does (Notion answers in JSON), other text as it is. */
export function readableResult(text: string): string {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return text;
  try {
    return readable(JSON.parse(t));
  } catch {
    return text; // trimmed, or not JSON after all
  }
}

export function readable(v: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (v === null || v === undefined) return "none";
  if (typeof v !== "object") return String(v);
  const lines = (value: unknown) => readable(value, depth + 1);
  const nested = (value: unknown) => value !== null && typeof value === "object" && Object.keys(value).length > 0;
  const multi = (value: unknown) => typeof value === "string" && value.includes("\n");
  const indent = (text: string) => text.split("\n").map((l) => `${pad}  ${l}`).join("\n");
  if (Array.isArray(v)) {
    if (!v.length) return "none";
    return v.map((item) => (nested(item) ? `${pad}- ${lines(item).trimStart()}` : multi(item) ? `${pad}-\n${indent(String(item))}` : `${pad}- ${lines(item)}`)).join("\n");
  }
  const entries = Object.entries(v);
  if (!entries.length) return "none";
  return entries
    .map(([k, value]) => (nested(value) ? `${pad}${k}:\n${lines(value)}` : multi(value) ? `${pad}${k}:\n${indent(String(value))}` : `${pad}${k}: ${lines(value)}`))
    .join("\n");
}
