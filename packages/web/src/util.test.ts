import { describe, expect, it } from "vitest";
import { shortTitle, timeAgoLong } from "./util.ts";

describe("timeAgoLong", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const before = (s: number) => new Date(now - s * 1000).toISOString();
  it("says how long ago, in words", () => {
    expect(timeAgoLong(before(20), now)).toBe("just now");
    expect(timeAgoLong(before(23 * 60), now)).toBe("23 minutes ago");
    expect(timeAgoLong(before(3600), now)).toBe("1 hour ago");
    expect(timeAgoLong(before(26 * 3600), now)).toBe("yesterday");
    expect(timeAgoLong(before(3 * 7 * 86_400), now)).toBe("3 weeks ago");
  });
});

describe("shortTitle", () => {
  it("keeps short titles and cuts long ones at a word", () => {
    expect(shortTitle("Fix sidebar")).toBe("Fix sidebar");
    expect(shortTitle("Without using any tools, say hello, then end your reply by asking me whether yo…")).toBe("Without using any tools, say hello, then…");
    expect(shortTitle("x".repeat(60))).toBe("x".repeat(40) + "…");
  });
});
