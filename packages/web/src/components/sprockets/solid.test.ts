import { describe, expect, it } from "vitest";
import { layerCount, layout, poseOf, type Body, type Pose } from "./solid.ts";

const box = { x: 40, y: 80, width: 120, height: 116 };
const face = { x: 100, y: 140 };
const box_ = (body: Body, p: Pose) => layout(p, 100, face, box, 50, body);
const at = (yaw: number, pitch = 0): Pose => ({ ...poseOf("front"), yaw, pitch });
const scaleX = (t: string) => Number(t.match(/scale\((-?[\d.]+)/)![1]);
const shiftX = (t: string) => Number(t.match(/translate\((-?[\d.]+)/)![1]);
const shiftY = (t: string) => Number(t.match(/translate\(-?[\d.]+ (-?[\d.]+)/)![1]);
/** How wide it looks: the widest reach of any slice either side of the axis. */
const span = (body: Body, yaw: number) =>
  Math.max(...box_(body, at(yaw)).layers.map((t) => Math.abs(shiftX(t) - 100) + (Math.abs(scaleX(t)) * box.width) / 2)) * 2;

const pizza: Body = { depth: 10, puff: 0 };
const bean: Body = { depth: 72, puff: 0.4 };

describe("a Sprocket as a solid", () => {
  it("is the flat drawing facing you: eyes upright where they're drawn", () => {
    for (const body of [pizza, bean]) {
      const l = box_(body, at(0));
      expect(l.layers).toHaveLength(layerCount(body));
      expect(l.layers.every((t) => shiftX(t) === 100)).toBe(true);
      expect(span(body, 0)).toBe(box.width); // the middle slice is the drawing
      expect(l.gap).toBe(0); // no strokes joining layers: the drawing as it is
      expect(l.eyes.transform).toBe("translate(100 140) rotate(0) scale(1 1)");
      expect(l.eyes.slant).toBe(0);
    }
  });

  it("a thin body narrows as it turns; a deep, round one stays round", () => {
    expect(span(pizza, 60)).toBeLessThan(box.width * 0.6);
    expect(span(bean, 60)).toBeGreaterThan(box.width * 0.75);
    expect(span(bean, 60)).toBeGreaterThan(span(pizza, 60) * 1.4);
  });

  it("its eyes ride the front, travelling further on a deep body", () => {
    const flat = shiftX(box_(pizza, at(40)).eyes.transform) - 100;
    const deep = shiftX(box_(bean, at(40)).eyes.transform) - 100;
    expect(flat).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(flat + 15);
    expect(shiftY(box_(bean, at(0, 20)).eyes.transform)).toBeLessThan(130); // tipped up, they travel up
  });

  it("looking up and to the right, each eye's top leans left", () => {
    expect(box_(bean, at(40, 26)).eyes.slant).toBeLessThan(-10);
  });

  it("in a spin, edge-on is a sliver, and past that its back, mirrored, with no eyes", () => {
    const edge = box_(bean, at(90));
    // Edge-on it draws denser slices, 1.5 units apart, each stroked twice that, so their round ends join into one side.
    expect(edge.layers).toHaveLength(layerCount(bean, true));
    expect(edge.gap).toBeCloseTo((2 * 72) / (layerCount(bean, true) - 1), 2);
    expect(edge.layers.every((t) => Math.abs(scaleX(t)) > 0)).toBe(true); // never scaled to nothing (it wouldn't draw)
    expect(edge.eyes.opacity).toBe(0);
    const back = box_(bean, at(180));
    expect(scaleX(back.layers.at(-1)!)).toBeLessThan(0);
    expect(back.eyes.opacity).toBe(0);
  });
});
