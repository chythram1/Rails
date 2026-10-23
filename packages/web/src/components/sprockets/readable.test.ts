import { describe, expect, it } from "vitest";
import { gist, readable, readableResult } from "./readable.ts";

describe("readable", () => {
  it("keeps text, numbers and yes/no as written", () => {
    expect(readable("looks good")).toBe("looks good");
    expect(readable(3)).toBe("3");
    expect(readable(false)).toBe("false");
    expect(readable(null)).toBe("none");
  });

  it("indents Notion's nested pages, one key or item per line, with multi-line text kept", () => {
    const pages = [
      { properties: { title: "Launch checklist" }, content: "- Define the scope\n- Test it" },
      { properties: { title: "Meeting notes" } },
    ];
    expect(readable(pages)).toBe(
      ["- properties:", "    title: Launch checklist", "  content:", "    - Define the scope", "    - Test it", "- properties:", "    title: Meeting notes"].join("\n"),
    );
    expect(readable({ page_id: "4022" })).toBe("page_id: 4022");
    expect(readable(["a", "b"])).toBe("- a\n- b");
    expect(readable({})).toBe("none");
  });

  it("lays out a JSON result, and leaves other text (or JSON cut short) as it is", () => {
    expect(readableResult('{"result":{"status":"success","id":"4022"}}')).toBe("result:\n  status: success\n  id: 4022");
    expect(readableResult("Added note 2.")).toBe("Added note 2.");
    expect(readableResult('{"pages":[{"id":"40')).toBe('{"pages":[{"id":"40');
  });

  it("finds a line to tell calls apart, skipping ids and looking inside nested arguments", () => {
    expect(gist({ page_id: "40223aa217f18114a725ca11763c4413", command: "update_properties", properties: { title: "Ideas (old)" } })).toBe("Ideas (old)");
    expect(gist({ command: "archive_page" })).toBe("archive_page");
    expect(gist({ page_id: "40223aa217f181a1bcf3e4520b0291b7", markdown: "looks good" })).toBe("looks good");
    expect(gist({ parent: { page_id: "40223aa217f18077a8d9cb8f389d8fab" }, pages: [{ properties: { title: "Launch checklist" } }] })).toBe("Launch checklist");
    expect(gist({ text: "Call Ada\nabout the launch" })).toBe("Call Ada");
    expect(gist({})).toBeUndefined();
  });
});
