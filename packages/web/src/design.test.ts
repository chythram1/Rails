import { describe, expect, it } from "vitest";
import design from "../../../DESIGN.md?raw";
import css from "./styles.css?raw";

// DESIGN.md's front matter mirrors the color tokens at the top of styles.css, so agents that read only
// DESIGN.md see the real values. styles.css is the source of truth; this keeps the copy honest.

/** `--name: #hex` declarations in :root. */
function cssColors(): Record<string, string> {
  const start = css.indexOf(":root {");
  const root = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

/** `  name: "#hex"` lines of the front matter's `colors:` block. */
function designColors(): Record<string, string> {
  const front = design.split("\n---\n")[0];
  const block = front.slice(front.indexOf("\ncolors:\n") + 9).split(/\n(?! )/)[0];
  return Object.fromEntries([...block.matchAll(/^ {2}([\w-]+):\s*"(#[0-9a-f]{3,8})"/gim)].map((m) => [m[1], m[2].toLowerCase()]));
}

describe("DESIGN.md", () => {
  it("lists exactly the color tokens of styles.css, with the same values", () => {
    expect(Object.keys(cssColors()).length).toBeGreaterThan(10);
    expect(designColors()).toEqual(cssColors());
  });
});
