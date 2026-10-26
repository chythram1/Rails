import { describe, expect, it } from "vitest";
import { statusText } from "./flight.ts";

const on = (name: string, phase: "working" | "thinking" | "typing" | null, step: string | null = null) => ({ name, phase, phased: 1, step, steps: step ? 1 : 0 });

describe("statusText", () => {
  it("says what one Sprocket is doing, as a Grok bot does", () => {
    expect(statusText([on("Bo", null)], false, 0)).toBe("Getting it done"); // before its run starts: working
    expect(statusText([on("Bo", "working")], false, 0.3)).toBe("Making progress");
    expect(statusText([on("Bo", "thinking")], false, 0.5)).toBe("Mulling it over");
    expect(statusText([on("Bo", "thinking", "Searching the web")], false, 0)).toBe("Searching the web"); // a step shows over any phase
    expect(statusText([on("Bo", "typing")], false, 0)).toBe("Typing…");
  });

  it("adds an ellipsis in a team, and names several", () => {
    expect(statusText([on("Bo", "working")], true, 0.99)).toBe("Chipping away…");
    expect(statusText([on("Bo", "typing")], true, 0)).toBe("Typing…");
    expect(statusText([on("Bo", "working"), on("Cy", "typing")], true, 0)).toBe("Bo and Cy are working…");
    expect(statusText([on("Bo", "typing"), on("Cy", "typing")], true, 0)).toBe("Bo and Cy are typing…");
    expect(statusText(["Bo", "Cy", "Di", "Ed"].map((n) => on(n, "working")), true, 0)).toBe("Bo, Cy and 2 others are working…");
    expect(statusText([], true, 0)).toBe("");
  });
});
