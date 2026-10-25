import { SPROCKET_CHARACTERS } from "@rails/shared";
import { describe, expect, it } from "vitest";
import { DOTS, dotsAt, GATHER, morph, specksAt, still, toDots, toSeed } from "./morph.ts";
import { CHARACTERS } from "./characters.ts";

describe("morph", () => {
  it("goes from one Sprocket to the next, between every pair of shapes", () => {
    for (const a of SPROCKET_CHARACTERS)
      for (const b of SPROCKET_CHARACTERS) {
        const m = morph({ character: a, color: "red" }, { character: b, color: "blue" });
        for (const t of [0, 0.5, 1]) expect(m(t).d).toMatch(/^M(?!.*NaN)/);
      }
  });

  it("mixes the colour, and moves the face", () => {
    const m = morph({ character: "block", color: "red" }, { character: "blob", color: "blue" });
    expect(m(0).color).toBe("#ff5c6c");
    expect(m(1).color).toBe("#63bdff");
    expect(m(0).face).toEqual(still({ character: "block", color: "red" }).face);
    expect(m(1).face).toEqual(still({ character: "blob", color: "blue" }).face);
  });
});

describe("the ellipsis", () => {
  const look = (character: (typeof SPROCKET_CHARACTERS)[number]) => ({ character, color: "green" as const });
  it("every body becomes three dots and back, its eyes fading as it goes", () => {
    for (const c of SPROCKET_CHARACTERS) {
      const step = toDots(look(c));
      expect(step(0).d, c).toBe(still(look(c)).d);
      expect(step(0).eyes, c).toBe(1);
      expect(step(1).eyes, c).toBe(0);
      expect(step(1).d.match(/M/g)?.length, c).toBe(3); // three rings
      expect(step(1).depth, c).toBeLessThan(10); // thin, like a mark
    }
  });
  it("the dots hop in turn, a wave going round", () => {
    const ys = (ms: number) => [...dotsAt(look("blob"), ms).d.matchAll(/M (\S+) (\S+)/g)].map((m) => Number(m[2]));
    const quarter = ys(DOTS.beat / 4);
    expect(quarter[0]).toBeLessThan(DOTS.y - DOTS.hop * 0.9); // the first is up
    expect(quarter[2]).toBeGreaterThan(quarter[0]); // the last is lower
    expect(ys(DOTS.beat * 0.75)).toEqual(ys(DOTS.beat * 1.75)); // and it repeats each beat
  });
});


describe("the spawn", () => {
  const specks = (ms: number) => (specksAt({ character: "blob", color: "teal" }, ms).match(/M/g) ?? []).length;

  it("every body shrinks into a seed where its face is, its eyes gone, and back", () => {
    for (const c of SPROCKET_CHARACTERS) {
      const seed = toSeed({ character: c, color: "teal" });
      expect(seed(0).d).toBe(still({ character: c, color: "teal" }).d);
      for (const t of [0.5, 1]) expect(seed(t).d).toMatch(/^M(?!.*NaN)/);
      expect(seed(1).eyes).toBe(0);
      const xs = [...seed(1).d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => Math.hypot(+m[1] - CHARACTERS[c].face.x, +m[2] - CHARACTERS[c].face.y));
      expect(Math.max(...xs)).toBeLessThan(GATHER.seed + 1);
    }
  });

  it("five specks spiral in one after another, and are gone by its end", () => {
    expect(specks(1)).toBe(1);
    expect(specks(GATHER.stagger + 10)).toBe(2);
    // Each joins the seed when it reaches it, so all five come and go.
    const counts = Array.from({ length: 100 }, (_, i) => specks(i * 20));
    expect(Math.max(...counts)).toBeLessThanOrEqual(GATHER.specks);
    expect(specks(GATHER.stagger * 4 + 10)).toBeGreaterThan(0);
    expect(specks(GATHER.ms)).toBe(0);
    // Coming in: the first speck is nearer its middle as it goes.
    const at = (ms: number) => {
      const [, x, y] = specksAt({ character: "blob", color: "teal" }, ms).match(/^M (-?[\d.]+) (-?[\d.]+)/)!.map(Number);
      return Math.hypot(x - CHARACTERS.blob.face.x, y - CHARACTERS.blob.face.y);
    };
    expect(at(600)).toBeLessThan(at(100));
  });
});
