import { describe, expect, it } from "vitest";
import { revealStep } from "./revealText.tsx";

describe("reply reveal", () => {
  it("catches up with what has arrived at a pace set by the backlog", () => {
    // 300 characters behind while the reply is written: about a 300 ms catch-up, 1 char/ms to start.
    expect(revealStep(0, 300, 33, true)).toBeCloseTo(33);
    // A small backlog still moves at the minimum pace, so the end of a burst doesn't crawl.
    expect(revealStep(98, 100, 33, true)).toBeCloseTo(99.32);
    // A huge burst is capped.
    expect(revealStep(0, 100_000, 10, true)).toBe(40);
  });

  it("finishes faster once the reply is done, and never shows more than has arrived", () => {
    expect(revealStep(0, 300, 33, false)).toBeGreaterThan(revealStep(0, 300, 33, true));
    expect(revealStep(299, 300, 1000, false)).toBe(300);
    expect(revealStep(300, 300, 33, true)).toBe(300);
  });
});
