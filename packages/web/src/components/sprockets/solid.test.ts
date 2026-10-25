import { describe, expect, it } from "vitest";
import { LAYERS, layout, poseOf, type Pose } from "./solid.ts";

const box = { x: 40, y: 80, width: 120, height: 116 };
const at = (yaw: number): Pose => ({ ...poseOf("front"), yaw });
const scaleX = (t: string) => Number(t.match(/scale\((-?[\d.]+)/)![1]);
const shiftX = (t: string) => Number(t.match(/translate\((-?[\d.]+)/)![1]);

describe("a Sprocket as a solid", () => {
  it("is the flat drawing facing you: no side, eyes where they're drawn", () => {
    const l = layout(at(0), 100, { x: 110, y: 140 }, box, 50);
    expect(l.layers).toHaveLength(LAYERS);
    expect(l.layers.every((t) => shiftX(t) === 100)).toBe(true); // every layer on the axis: no depth shows
    expect(l.band.opacity).toBe(0);
    expect(l.eyes.opacity).toBe(1);
    expect(l.eyes.transform).toMatch(/^translate\(110 140\) rotate\(0\) scale\(1 1\)/); // exactly the flat drawing
  });

  it("turned, hardly narrows: its face travels toward the turn, eyes narrowing", () => {
    const l = layout(at(40), 100, { x: 100, y: 140 }, box, 50);
    const front = l.layers[LAYERS - 1];
    expect(scaleX(front)).toBeGreaterThan(0.85); // never thin
    expect(shiftX(front)).toBeGreaterThan(100);
    expect(shiftX(l.layers[0])).toBeLessThan(100);
    expect(shiftX(l.eyes.transform)).toBeGreaterThan(shiftX(front) + 8); // the face moves, not the body
    expect(scaleX(l.eyes.transform)).toBeLessThan(1);
    expect(l.eyes.opacity).toBe(1);
  });

  it("looking up and to the right, each eye's top leans left; facing you they stand upright", () => {
    expect(layout(at(0), 100, { x: 100, y: 140 }, box, 50).eyes.slant).toBe(0);
    expect(layout({ ...at(40), pitch: 26 }, 100, { x: 100, y: 140 }, box, 50).eyes.slant).toBeLessThan(-10);
  });

  it("tipped up, its face travels up", () => {
    const l = layout({ ...at(0), pitch: 20 }, 100, { x: 100, y: 140 }, box, 50);
    expect(Number(l.eyes.transform.match(/translate\([\d.]+ ([\d.]+)/)![1])).toBeLessThan(135);
  });

  it("in a spin, edge-on is a sliver, and past that its back, mirrored, with no eyes", () => {
    const edge = layout(at(90), 100, { x: 100, y: 140 }, box, 50);
    expect(edge.band.opacity).toBe(1);
    expect(edge.band.width).toBeGreaterThan(20);
    expect(edge.eyes.opacity).toBe(0);
    const back = layout(at(180), 100, { x: 100, y: 140 }, box, 50);
    expect(scaleX(back.layers[LAYERS - 1])).toBeLessThan(0);
    expect(back.eyes.opacity).toBe(0);
  });
});
