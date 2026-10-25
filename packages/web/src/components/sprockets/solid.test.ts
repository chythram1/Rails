import { describe, expect, it } from "vitest";
import { EYE_X, layerCount, layout, poseOf, POSES, type Body, type Pose } from "./solid.ts";

const box = { x: 40, y: 80, width: 120, height: 116 };
const mid = box.y + box.height / 2;
const face = { x: 100, y: mid };
const box_ = (body: Body, p: Pose) => layout(p, 100, face, box, 50, body);
const at = (yaw: number, pitch = 0): Pose => ({ ...poseOf("front"), yaw, pitch });
const matrix = (t: string) => t.match(/matrix\(([^)]*)\)/)![1].split(" ").map(Number);
/** Where a slice's middle lands, and how wide it looks: the widest reach of any slice either side of the axis. */
const centre = (t: string) => {
  const [a, , c, , e] = matrix(t);
  return a * 100 + c * mid + e;
};
const span = (body: Body, yaw: number) =>
  Math.max(...box_(body, at(yaw)).layers.map((t) => Math.abs(centre(t) - 100) + (Math.abs(matrix(t)[0]) * box.width) / 2)) * 2;
/** How wide eye `side` looks across its middle, at pose `p`. */
const eyeWidth = (body: Body, p: Pose, side: -1 | 1) => {
  const { project } = box_(body, p).eyes;
  const [l, r] = [project(side * EYE_X - 7, 0), project(side * EYE_X + 7, 0)];
  return Math.hypot(r[0] - l[0], r[1] - l[1]);
};

const pizza: Body = { depth: 10, puff: 0 };
const bean: Body = { depth: 110, puff: 0.4 };

describe("a Sprocket as a solid", () => {
  it("is the flat drawing facing you: eyes where they're drawn, upright", () => {
    for (const body of [pizza, bean]) {
      const l = box_(body, at(0));
      expect(l.layers).toHaveLength(layerCount(body));
      expect(l.layers.every((t) => Math.abs(centre(t) - 100) < 0.01)).toBe(true);
      expect(span(body, 0)).toBe(box.width); // the middle slice is the drawing
      expect(l.gap).toBe(0); // no strokes joining layers: the drawing as it is
      const [x, y] = l.eyes.project(0, 0);
      expect(x).toBeCloseTo(face.x, 1);
      expect(y).toBeCloseTo(face.y, 1);
      expect(l.eyes.opacity).toEqual([1, 1]);
      expect(eyeWidth(body, at(0), -1)).toBeCloseTo(eyeWidth(body, at(0), 1), 1);
    }
  });

  it("a thin body narrows as it turns; a deep, round one stays round", () => {
    expect(span(pizza, 60)).toBeLessThan(box.width * 0.6);
    expect(span(bean, 60)).toBeGreaterThan(box.width * 0.75);
    expect(span(bean, 60)).toBeGreaterThan(span(pizza, 60) * 1.4);
  });

  it("tipped and turned, a flat body shears: its upright edges lean", () => {
    const [, , c] = matrix(box_(pizza, at(33, 16)).layers[0]);
    expect(c).toBeGreaterThan(0.1); // higher up, further left: a parallelogram
  });

  it("its eyes ride the front, travelling further on a deep body", () => {
    const x = (body: Body, p: Pose) => box_(body, p).eyes.project(0, 0)[0] - 100;
    expect(x(pizza, at(40))).toBeGreaterThan(0);
    expect(x(bean, at(40))).toBeGreaterThan(x(pizza, at(40)) + 25);
    expect(box_(bean, at(0, 20)).eyes.project(0, 0)[1]).toBeLessThan(mid - 15); // tipped up, they travel up
  });

  it("at rest, the far eye narrows on a round face, as on a ball; on a flat one both match", () => {
    const rest = poseOf("rest");
    expect(eyeWidth(bean, rest, 1)).toBeLessThan(eyeWidth(bean, rest, -1) * 0.85);
    expect(eyeWidth(pizza, rest, 1)).toBeCloseTo(eyeWidth(pizza, rest, -1), 1);
    expect(POSES.rest).toMatchObject({ yaw: 33, pitch: 16, roll: -25 });
  });

  it("looking up and to the right, an upright eye's top leans left", () => {
    const { project } = box_(bean, at(33, 16)).eyes;
    expect(project(EYE_X, -15)[0]).toBeLessThan(project(EYE_X, 15)[0]);
  });

  it("in a spin, edge-on is a sliver, and past that its back, mirrored, with no eyes", () => {
    const edge = box_(bean, at(90));
    // Edge-on it draws denser slices, each stroked so their round ends join into one side.
    expect(edge.layers).toHaveLength(layerCount(bean, true));
    expect(edge.layers.every((t) => Math.abs(matrix(t)[0]) > 0)).toBe(true); // never squashed to nothing
    // Edge-on, the eye on the far side is gone; the near one, on the round face's last sliver, has mostly faded.
    expect(edge.eyes.opacity[1]).toBe(0);
    expect(edge.eyes.opacity[0]).toBeLessThan(0.5);
    const back = box_(bean, at(180));
    expect(matrix(back.layers.at(-1)!)[0]).toBeLessThan(0);
    expect(back.eyes.opacity).toEqual([0, 0]);
  });
});
