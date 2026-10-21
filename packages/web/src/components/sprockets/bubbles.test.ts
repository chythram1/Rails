import { describe, expect, it } from "vitest";
import { bubbles } from "./bubbles.ts";

describe("bubbles", () => {
  it("splits a reply at blank lines", () => {
    expect(bubbles("One.\n\nTwo.\n\n\nThree.")).toEqual(["One.", "Two.", "Three."]);
  });
  it("keeps a single paragraph whole, line breaks and all", () => {
    expect(bubbles("Line one\nline two")).toEqual(["Line one\nline two"]);
  });
  it("never splits a code block", () => {
    expect(bubbles("Try this:\n\n```js\na();\n\nb();\n```\n\nDone.")).toEqual(["Try this:\n```js\na();\n\nb();\n```", "Done."]);
  });
  it("keeps an introduction with what it introduces, and a list together", () => {
    expect(bubbles("Three things:\n\n- one\n\n- two\n\n- three\n\nThat's it.")).toEqual(["Three things:\n- one\n- two\n- three", "That's it."]);
  });
  it("splits a long paragraph between sentences", () => {
    const long = "This sentence is about forty characters. ".repeat(10).trim();
    const parts = bubbles(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join(" ")).toBe(long);
    expect(parts.every((p) => p.endsWith("."))).toBe(true);
    expect(bubbles("Short. Paragraph.")).toEqual(["Short. Paragraph."]);
  });
  it("returns the text when it's all blank", () => {
    expect(bubbles("  ")).toEqual(["  "]);
  });
});
