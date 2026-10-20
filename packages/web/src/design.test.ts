import { describe, expect, it } from "vitest";
import design from "../../../DESIGN.md?raw";
import css from "./styles.css?raw";

// DESIGN.md's front matter mirrors the color tokens at the top of styles.css (both palettes, the light one's
// names prefixed `light-`), so agents that read only DESIGN.md see the real values. styles.css is the source of
// truth; this keeps the copy honest.

/** `--name: #hex` declarations in the block that starts with `selector {`. */
function cssColors(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const dark = cssColors(':root:not([data-theme="light"])');
const light = cssColors(':root[data-theme="light"]');

/** `  name: "#hex"` lines of the front matter's `colors:` block. */
function designColors(): Record<string, string> {
  const front = design.split("\n---\n")[0];
  const block = front.slice(front.indexOf("\ncolors:\n") + 9).split(/\n(?! )/)[0];
  return Object.fromEntries([...block.matchAll(/^ {2}([\w-]+):\s*"(#[0-9a-f]{3,8})"/gim)].map((m) => [m[1], m[2].toLowerCase()]));
}

describe("the palettes", () => {
  it("give every color token a value in both themes", () => {
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it("are listed in DESIGN.md with the same values", () => {
    const lightNamed = Object.fromEntries(Object.entries(light).map(([k, v]) => [`light-${k}`, v]));
    expect(designColors()).toEqual({ ...dark, ...lightNamed });
  });
});
