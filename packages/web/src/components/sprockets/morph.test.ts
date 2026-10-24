import { SPROCKET_CHARACTERS } from "@rails/shared";
import { describe, expect, it } from "vitest";
import { morph, still } from "./morph.ts";

describe("morph", () => {
  it("goes from one Sprocket to the next, between every pair of shapes", () => {
    for (const a of SPROCKET_CHARACTERS)
      for (const b of SPROCKET_CHARACTERS) {
        const m = morph({ character: a, color: "red" }, { character: b, color: "blue" });
        for (const t of [0, 0.5, 1]) expect(m(t).d).toMatch(/^M(?!.*NaN)/);
      }
  });

  it("mixes the colour, and moves the face", () => {
    const m = morph({ character: "block", color: "red" }, { character: "bean", color: "blue" });
    expect(m(0).color).toBe("#ff5c6c");
    expect(m(1).color).toBe("#63bdff");
    expect(m(0).face).toEqual(still({ character: "block", color: "red" }).face);
    expect(m(1).face).toEqual(still({ character: "bean", color: "blue" }).face);
  });
});
