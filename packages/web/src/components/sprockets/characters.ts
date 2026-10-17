// The cast (see docs/CONTEXT.md "Sprocket"). Every character shares one coordinate system, a 200×215
// viewBox with the ground at y = 200, so accessories drawn at an anchor fit any character.
import type { SprocketCharacter } from "@rails/shared";

type Point = [number, number];

/** A body shape: a path, or an ellipse (bodies made of several shapes overlap into one blob). */
export type Primitive = { d: string } | { cx: number; cy: number; rx: number; ry: number; rot?: number };

export interface CharacterDef {
  name: string;
  color: string;
  body: Primitive[];
  /** Stroke in the body colour, which rounds sharp tips (e.g. the moon's horns). */
  round?: number;
  /** Centre of the face, and how much the eyes lean (degrees). */
  face: { x: number; y: number; tilt: number };
  /** Where a hat sits: its bottom centre, and its tilt. */
  hat: { x: number; y: number; rot: number };
  /** Headphones: the line through the ear cups, the body's half-width there, and the top of the head. */
  ears: { x: number; y: number; half: number; top: number };
  /** Scarf: the neck line and the body's half-width there. */
  neck: { x: number; y: number; half: number };
  /** Scarf colours, for a body the default purple scarf would vanish on. */
  scarf?: { main: string; shade: string };
  /** Ground shadow: centre and half-width. */
  shadow: { x: number; half: number };
  /** Idle speed multiplier, so characters shown together don't bob in sync. */
  tempo: number;
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

/** A crescent: the circle (cx, cy, r) with the circle (cx2, cy2, r2) cut out of it. */
function crescent(cx: number, cy: number, r: number, cx2: number, cy2: number, r2: number): string {
  const dx = cx2 - cx;
  const dy = cy2 - cy;
  const d = Math.hypot(dx, dy);
  const a = (r * r - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r * r - a * a);
  const bx = cx + (a * dx) / d;
  const by = cy + (a * dy) / d;
  const p1: Point = [bx + (h * dy) / d, by - (h * dx) / d];
  const p2: Point = [bx - (h * dy) / d, by + (h * dx) / d];
  return `M ${f(p1[0])} ${f(p1[1])} A ${r} ${r} 0 1 0 ${f(p2[0])} ${f(p2[1])} A ${r2} ${r2} 0 0 1 ${f(p1[0])} ${f(p1[1])} Z`;
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
    color: "#FFCB1F",
    body: [{ d: roundedPoly([[46, 86], [154, 86], [154, 196], [46, 196]], 30) }],
    face: { x: 100, y: 138, tilt: 6 },
    hat: { x: 100, y: 94, rot: 0 },
    ears: { x: 100, y: 134, half: 54, top: 86 },
    neck: { x: 100, y: 174, half: 54 },
    shadow: { x: 100, half: 52 },
    tempo: 1,
  },
  bean: {
    name: "Bean",
    color: "#4CC552",
    body: [{ d: "M 64 84 C 92 68 122 78 128 104 C 132 122 150 126 164 140 C 182 160 172 196 132 196 L 96 196 C 56 196 36 168 38 134 C 40 108 48 92 64 84 Z" }],
    face: { x: 110, y: 150, tilt: 10 },
    hat: { x: 80, y: 90, rot: -22 },
    ears: { x: 100, y: 138, half: 60, top: 78 },
    neck: { x: 104, y: 178, half: 60 },
    shadow: { x: 104, half: 56 },
    tempo: 0.92,
  },
  lune: {
    name: "Lune",
    color: "#A97BFF",
    body: [{ d: crescent(98, 138, 58, 142, 102, 42) }],
    round: 12,
    face: { x: 80, y: 150, tilt: 8 },
    hat: { x: 74, y: 92, rot: -24 },
    ears: { x: 96, y: 140, half: 62, top: 80 },
    neck: { x: 96, y: 180, half: 44 },
    scarf: { main: "#FF7A8A", shade: "#E8606F" },
    shadow: { x: 100, half: 54 },
    tempo: 1.12,
  },
  bell: {
    name: "Bell",
    color: "#FF5C6C",
    body: [{ d: "M 100 80 C 132 80 146 102 148 134 C 150 160 158 172 170 182 C 178 190 172 197 160 197 L 40 197 C 28 197 22 190 30 182 C 42 172 50 160 52 134 C 54 102 68 80 100 80 Z" }],
    face: { x: 100, y: 146, tilt: 6 },
    hat: { x: 100, y: 88, rot: 0 },
    ears: { x: 100, y: 136, half: 48, top: 80 },
    neck: { x: 100, y: 174, half: 58 },
    shadow: { x: 100, half: 62 },
    tempo: 0.96,
  },
  starry: {
    name: "Starry",
    color: "#63BDFF",
    body: [{ d: roundedPoly(star(100, 140, 68, 38, 5), (i) => (i % 2 ? 12 : 26)) }],
    face: { x: 100, y: 146, tilt: 6 },
    hat: { x: 100, y: 94, rot: 0 },
    ears: { x: 100, y: 140, half: 58, top: 86 },
    neck: { x: 100, y: 170, half: 44 },
    shadow: { x: 100, half: 54 },
    tempo: 1.06,
  },
  cog: {
    name: "Cog",
    color: "#FF8C1A",
    body: [{ d: roundedPoly(gear(100, 138, 60, 47, 8), 6) }],
    face: { x: 100, y: 140, tilt: 6 },
    hat: { x: 84, y: 92, rot: -18 },
    ears: { x: 100, y: 138, half: 58, top: 80 },
    neck: { x: 100, y: 172, half: 50 },
    shadow: { x: 100, half: 50 },
    tempo: 0.9,
  },
  roo: {
    name: "Roo",
    color: "#14CDBE",
    body: [{ d: roundedPoly([[100, 74], [162, 136], [100, 198], [38, 136]], 22) }],
    face: { x: 100, y: 138, tilt: 6 },
    hat: { x: 100, y: 92, rot: 0 },
    ears: { x: 100, y: 132, half: 56, top: 82 },
    neck: { x: 100, y: 168, half: 32 },
    shadow: { x: 100, half: 44 },
    tempo: 1.04,
  },
  momo: {
    name: "Momo",
    color: "#FF92CF",
    body: [
      { cx: 77, cy: 140, rx: 43, ry: 56, rot: -6 },
      { cx: 123, cy: 140, rx: 43, ry: 56, rot: 6 },
    ],
    face: { x: 100, y: 150, tilt: 6 },
    hat: { x: 100, y: 96, rot: 0 },
    ears: { x: 100, y: 138, half: 64, top: 86 },
    neck: { x: 100, y: 176, half: 62 },
    shadow: { x: 100, half: 62 },
    tempo: 0.98,
  },
};
