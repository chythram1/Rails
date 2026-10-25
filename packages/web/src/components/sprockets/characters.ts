// The cast (see docs/CONTEXT.md "Sprocket"). Every character shares one coordinate system, a 200×215
// viewBox with the ground at y = 200.
import type { SprocketCharacter, SprocketColor } from "@rails/shared";

/** Body colours, in picker order. Dark enough eyes stay readable on every one. */
export const COLORS: Record<SprocketColor, string> = {
  brown: "#B5824F",
  red: "#FF5C6C",
  orange: "#FF8C1A",
  yellow: "#FFCB1F",
  green: "#4CC552",
  teal: "#14CDBE",
  blue: "#63BDFF",
  purple: "#A97BFF",
  pink: "#FF92CF",
  grey: "#A3A3AD",
};

type Point = [number, number];

/** A body shape: a path, or an ellipse (bodies made of several shapes overlap into one blob). */
export type Primitive = { d: string } | { cx: number; cy: number; rx: number; ry: number; rot?: number };

interface CharacterDef {
  name: string;
  body: Primitive[];
  /** How thick it is (viewBox units; bodies are about 120 wide), and how much its outline shrinks toward its front
   * and back (0 for straight sides, like a box; 0.4 for a soft, round body). solid.ts draws it. */
  depth: number;
  puff: number;
  /** A round body is spun (1): a solid turned about its upright middle, like a ball or a bell, whose outline stays put
   * as it turns, only its eyes travelling round. A flat one (0, or left out) is a slab of its outline that shears and
   * narrows. solid.ts draws it. */
  spun?: number;
  /** Centre of the face. The eyes stand upright facing you; the pose slants them (solid.ts). */
  face: { x: number; y: number };
  /** Ground shadow: centre and half-width. */
  shadow: { x: number; half: number };
}

const f = (n: number) => +n.toFixed(2);

/** A polygon with rounded corners (quadratic curves cut `r` back from each vertex). */
function roundedPoly(points: Point[], radius: number | ((i: number) => number)): string {
  const n = points.length;
  const corner = (i: number) => {
    const [x, y] = points[i];
    const [px, py] = points[(i + n - 1) % n];
    const [nx, ny] = points[(i + 1) % n];
    const lp = Math.hypot(px - x, py - y);
    const ln = Math.hypot(nx - x, ny - y);
    const r = Math.min(typeof radius === "number" ? radius : radius(i), lp / 2, ln / 2);
    return { v: [x, y], a: [x + ((px - x) / lp) * r, y + ((py - y) / lp) * r], b: [x + ((nx - x) / ln) * r, y + ((ny - y) / ln) * r] };
  };
  const cs = points.map((_, i) => corner(i));
  let d = `M ${f(cs[0].b[0])} ${f(cs[0].b[1])}`;
  for (let i = 1; i <= n; i++) {
    const c = cs[i % n];
    d += ` L ${f(c.a[0])} ${f(c.a[1])} Q ${f(c.v[0])} ${f(c.v[1])} ${f(c.b[0])} ${f(c.b[1])}`;
  }
  return d + " Z";
}

/** Points on a circle; angle 0 points up. */
const polar = (cx: number, cy: number, r: number, deg: number): Point => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** A drop, point up: the circle (cx, cy, r) and its two tangents meeting `rise` above its centre, the point rounded
 * `tip` back along them. */
function drop(cx: number, cy: number, r: number, rise: number, tip: number): string {
  const top: Point = [cx, cy - rise];
  const phi = Math.acos(r / rise); // from straight up to where each tangent touches the circle
  const [sx, sy] = [r * Math.sin(phi), r * Math.cos(phi)];
  const right: Point = [cx + sx, cy - sy];
  const left: Point = [cx - sx, cy - sy];
  const along = (to: Point): Point => {
    const l = Math.hypot(to[0] - top[0], to[1] - top[1]);
    return [top[0] + ((to[0] - top[0]) / l) * tip, top[1] + ((to[1] - top[1]) / l) * tip];
  };
  const [a, b] = [along(left), along(right)];
  return `M ${f(a[0])} ${f(a[1])} Q ${f(top[0])} ${f(top[1])} ${f(b[0])} ${f(b[1])} L ${f(right[0])} ${f(right[1])} A ${r} ${r} 0 1 1 ${f(left[0])} ${f(left[1])} Z`;
}

function star(cx: number, cy: number, outer: number, inner: number, points: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points * 2; i++) out.push(polar(cx, cy, i % 2 ? inner : outer, (i * 180) / points));
  return out;
}

function gear(cx: number, cy: number, outer: number, inner: number, teeth: number): Point[] {
  const out: Point[] = [];
  const step = 360 / teeth;
  for (let i = 0; i < teeth; i++) {
    const b = i * step;
    out.push(polar(cx, cy, inner, b - step * 0.31), polar(cx, cy, outer, b - step * 0.18), polar(cx, cy, outer, b + step * 0.18), polar(cx, cy, inner, b + step * 0.31));
  }
  return out;
}

// Paths are computed once, when the module loads.
export const CHARACTERS: Record<SprocketCharacter, CharacterDef> = {
  block: {
    name: "Block",
    depth: 10,
    puff: 0, // a pizza box: thin and flat
    body: [{ d: roundedPoly([[46, 86], [154, 86], [154, 196], [46, 196]], 30) }],
    face: { x: 100, y: 138 },
    shadow: { x: 100, half: 52 },
  },
  blob: {
    name: "Blob",
    depth: 120,
    puff: 0.4,
    spun: 1, // a ball
    body: [{ cx: 100, cy: 138, rx: 60, ry: 60 }],
    face: { x: 100, y: 138 },
    shadow: { x: 100, half: 56 },
  },
  drop: {
    name: "Drop",
    depth: 104,
    puff: 0.4,
    spun: 1, // a drop, its point up, well above its round part so it isn't a ball with a bump
    body: [{ d: drop(100, 146, 52, 92, 22) }],
    face: { x: 100, y: 148 },
    shadow: { x: 100, half: 50 },
  },
  bell: {
    name: "Bell",
    depth: 106,
    puff: 0.4,
    spun: 1,
    body: [{ d: "M 100 80 C 132 80 146 102 148 134 C 150 160 158 172 170 182 C 178 190 172 197 160 197 L 40 197 C 28 197 22 190 30 182 C 42 172 50 160 52 134 C 54 102 68 80 100 80 Z" }],
    face: { x: 100, y: 136 },
    shadow: { x: 100, half: 62 },
  },
  starry: {
    name: "Starry",
    depth: 12,
    puff: 0.04, // thin
    body: [{ d: roundedPoly(star(100, 140, 68, 38, 5), (i) => (i % 2 ? 12 : 26)) }],
    face: { x: 100, y: 146 },
    shadow: { x: 100, half: 54 },
  },
  cog: {
    name: "Cog",
    depth: 22,
    puff: 0.06,
    body: [{ d: roundedPoly(gear(100, 138, 60, 47, 8), 6) }],
    face: { x: 100, y: 140 },
    shadow: { x: 100, half: 50 },
  },
  roo: {
    name: "Roo",
    depth: 26,
    puff: 0.12,
    body: [{ d: roundedPoly([[100, 74], [162, 136], [100, 198], [38, 136]], 22) }],
    face: { x: 100, y: 138 },
    shadow: { x: 100, half: 44 },
  },
  momo: {
    name: "Momo",
    depth: 110,
    puff: 0.4,
    spun: 1,
    body: [
      { cx: 77, cy: 140, rx: 43, ry: 56, rot: -6 },
      { cx: 123, cy: 140, rx: 43, ry: 56, rot: 6 },
    ],
    face: { x: 100, y: 138 },
    shadow: { x: 100, half: 62 },
  },
};
