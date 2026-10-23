import { describe, expect, it } from "vitest";
import { blocks, inline, plain } from "./marks.ts";

describe("the Markdown in a reply", () => {
  it("reads `code` and **bold** between plain text", () => {
    expect(inline("Run `npm test` and answer **Yes**.")).toEqual([
      { kind: "text", text: "Run " },
      { kind: "code", text: "npm test" },
      { kind: "text", text: " and answer " },
      { kind: "strong", text: "Yes" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves what isn't a mark as typed", () => {
    for (const t of ["2 * 3 * 4", "a ** b", "** not bold **", "an `unclosed tick", "snake_case_name", "* a list item"])
      expect(inline(t)).toEqual([{ kind: "text", text: t }]);
    expect(inline("`a\nb`")).toEqual([{ kind: "text", text: "`a\nb`" }]);
  });

  it("keeps code as written inside it, ** and all", () => {
    expect(inline("`a **b** c`")).toEqual([{ kind: "code", text: "a **b** c" }]);
  });

  it("takes fenced code blocks out of the text, closed or not", () => {
    expect(blocks("It printed:\n```text\n3.0.5\n```\nDone.")).toEqual([
      { kind: "text", marks: [{ kind: "text", text: "It printed:" }] },
      { kind: "fence", lang: "text", code: "3.0.5" },
      { kind: "text", marks: [{ kind: "text", text: "Done." }] },
    ]);
    expect(blocks("```\nls src")).toEqual([{ kind: "fence", lang: "", code: "ls src" }]);
  });

  it("drops the marks for a one-line preview", () => {
    expect(plain("Answer **Yes**: run `node --test`.")).toBe("Answer Yes: run node --test.");
  });
});
