// Morphing one Sprocket into another (ADR 0033's thinking icon): the body's outline, its colour, where the face sits
// and the eyes' lean, all at a point `t` between the two. Bodies are paths, or several ellipses that overlap into one
// blob (momo); flubber matches their outlines.
import { combine, interpolate, interpolateAll, separate, type Interpolator } from "flubber";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, COLORS, type Primitive } from "./characters.ts";

/** A Sprocket's drawing at one point of a morph. */
export interface Drawing {
  /** The body, as one path (several rings for a body of several shapes). */
  d: string;
  color: string;
  /** The body's thickness, puff and how spun it is (characters.ts). */
  depth: number;
  puff: number;
  spun: number;
  face: { x: number; y: number };
  /** How much the eyes show (1 if left out): they fade as it becomes three dots. */
  eyes?: number;
}

/** Points round an ellipse, as flubber takes a ring. */
function ring(p: Extract<Primitive, { cx: number }>, n = 48): number[][] {
  const rot = ((p.rot ?? 0) * Math.PI) / 180;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = p.rx * Math.cos(a);
    const y = p.ry * Math.sin(a);
    return [p.cx + x * Math.cos(rot) - y * Math.sin(rot), p.cy + x * Math.sin(rot) + y * Math.cos(rot)];
  });
}

const shapesOf = (look: SprocketLook) => CHARACTERS[look.character].body.map((p) => ("d" in p ? p.d : ring(p)));

/** `a` and `b` mixed at `t`, round the hue wheel in OKLCH (in RGB or OKLab a red and a teal pass through grey); the ends
 * are the colours as they are. */
function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a.toLowerCase();
  if (t >= 1) return b.toLowerCase();
  return `color-mix(in oklch, ${a} ${+((1 - t) * 100).toFixed(1)}%, ${b})`;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The outline from `a`'s body to `b`'s, one shape or several on either side. */
function outline(a: SprocketLook, b: SprocketLook): Interpolator {
  const [from, to] = [shapesOf(a), shapesOf(b)];
  const options = { maxSegmentLength: 4, single: true };
  if (from.length === 1 && to.length === 1) return interpolate(from[0], to[0], options);
  if (from.length === 1) return separate(from[0], to, options);
  if (to.length === 1) return combine(from, to[0], options);
  return interpolateAll(from, to, options);
}

/** A function from `t` (0 is `a`, 1 is `b`) to the drawing between them. */
export function morph(a: SprocketLook, b: SprocketLook): (t: number) => Drawing {
  const [da, db] = [CHARACTERS[a.character], CHARACTERS[b.character]];
  const body = outline(a, b);
  return (t) => ({
    d: body(t),
    color: mix(COLORS[a.color], COLORS[b.color], t),
    depth: lerp(da.depth, db.depth, t),
    spun: lerp(da.spun ?? 0, db.spun ?? 0, t),
    puff: lerp(da.puff, db.puff, t),
    face: { x: lerp(da.face.x, db.face.x, t), y: lerp(da.face.y, db.face.y, t) },
  });
}

/** A Sprocket's drawing, still. */
export function still(look: SprocketLook): Drawing {
  const def = CHARACTERS[look.character];
  const shapes = shapesOf(look);
  const d = shapes.map((s) => (typeof s === "string" ? s : `M ${s.map((p) => p.join(" ")).join(" L ")} Z`)).join(" ");
  return { d, color: COLORS[look.color], depth: def.depth, puff: def.puff, spun: def.spun ?? 0, face: { ...def.face } };
}

// ---- the ellipsis: a Sprocket thinking in a direct chat becomes three dots (as a Grok bot does) ----

/** The three dots' centres and size (viewBox), low on the body like a typing ellipsis. */
export const DOTS = { y: 156, xs: [60, 100, 140], r: 17, hop: 11, beat: 900 } as const;
const circle = (cx: number, cy: number, r: number) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;

/** From `t` 0 (its body) to 1 (three dots at rest) and the drawing between: its outline splits into the dots, it
 * thins and its eyes fade. */
export function toDots(look: SprocketLook): (t: number) => Drawing {
  const def = CHARACTERS[look.character];
  const from = shapesOf(look);
  const dots = DOTS.xs.map((x) => ring({ cx: x, cy: DOTS.y, rx: DOTS.r, ry: DOTS.r }, 32));
  const options = { maxSegmentLength: 4, single: true };
  // One shape splits in three; several (momo's two) each become one, the last twice over.
  const body = from.length === 1 ? separate(from[0], dots, options) : interpolateAll([...from, from[from.length - 1]].slice(0, 3), dots, options);
  return (t) => ({
    d: t <= 0 ? still(look).d : body(t),
    color: COLORS[look.color],
    depth: lerp(def.depth, 8, t),
    spun: lerp(def.spun ?? 0, 0, t),
    puff: lerp(def.puff, 0, t),
    face: { ...def.face },
    eyes: Math.max(0, 1 - t * 1.6),
  });
}

/** The three dots `ms` into their bounce: each hops in turn, a wave going round every DOTS.beat. */
export function dotsAt(look: SprocketLook, ms: number): Drawing {
  const d = DOTS.xs
    .map((x, i) => {
      const phase = (ms / DOTS.beat) * Math.PI * 2 - i * 0.9;
      return circle(x, DOTS.y - DOTS.hop * Math.max(0, Math.sin(phase)), DOTS.r);
    })
    .join(" ");
  return { ...toDots(look)(1), d };
}

