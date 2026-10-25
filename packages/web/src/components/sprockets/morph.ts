// Morphing one Sprocket into another (ADR 0033's thinking icon): the body's outline, its colour, where the face sits
// and the eyes' lean, all at a point `t` between the two. Bodies are paths, or several ellipses that overlap into one
// blob (momo); flubber matches their outlines.
import { combine, interpolate, interpolateAll, separate, type Interpolator } from "flubber";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, COLORS, type Primitive } from "./characters.ts";

/** A Sprocket's drawing at one point of a morph. */
export interface Frame {
  /** The body, as one path (several rings for a body of several shapes). */
  d: string;
  color: string;
  /** Stroke in the body colour that rounds sharp tips (lune's horns); 0 for none. */
  round: number;
  face: { x: number; y: number };
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
export function morph(a: SprocketLook, b: SprocketLook): (t: number) => Frame {
  const [da, db] = [CHARACTERS[a.character], CHARACTERS[b.character]];
  const body = outline(a, b);
  return (t) => ({
    d: body(t),
    color: mix(COLORS[a.color], COLORS[b.color], t),
    round: lerp(da.round ?? 0, db.round ?? 0, t),
    face: { x: lerp(da.face.x, db.face.x, t), y: lerp(da.face.y, db.face.y, t) },
  });
}

/** A Sprocket's drawing, still. */
export function still(look: SprocketLook): Frame {
  const def = CHARACTERS[look.character];
  const shapes = shapesOf(look);
  const d = shapes.map((s) => (typeof s === "string" ? s : `M ${s.map((p) => p.join(" ")).join(" L ")} Z`)).join(" ");
  return { d, color: COLORS[look.color], round: def.round ?? 0, face: { ...def.face } };
}
