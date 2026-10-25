// A Sprocket's eyes, drawn on its face (solid.ts): each eye's shapes are worked out where it sits on the face, upright
// from the face's centre, then every point is placed through the pose's projection, so an eye on the far side of a
// round face narrows and bends, and the pair slants with the turn. The renderer redraws them every frame (engine.ts):
// moved and sized, its lid, and how happy it is, the open eye squashing away as the happy arc (^) grows in.

import type { EyeShape } from "./clips.ts";
import { EYE_X } from "./solid.ts";

const INK = "#17171c";
/** An open eye's size: a capsule, 14 wide and 31 tall. */
const EYE = { w: 14, h: 31 };
/** How much further out the happy arcs sit than the open eyes, so ^ ^ isn't crowded. */
const HAPPY_OUT = 4;

type Project = (x: number, y: number) => [number, number];

/** One eye as drawn: its open shape's and happy arc's paths, and how much of each shows. */
export interface EyeDraw {
  open: string;
  openOpacity: number;
  happy: string;
  happyOpacity: number;
}

const path = (pts: [number, number][], close: boolean) => "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + (close ? "Z" : "");

/**
 * Eye `side` (-1 its left as you see it, 1 its right) for shape `s`, looking `look` (face units), lids `lid` shut (0
 * to 1) and `happy` (0 to 1): a capsule with fully round ends (a circle when it's as wide as it's tall, a rounded line
 * as the lid shuts, widening a touch), and the arc, each traced on the face and projected.
 */
export function eyeDraw(side: -1 | 1, s: EyeShape, look: [number, number], lid: number, happy: number, project: Project): EyeDraw {
  const shut = 1 - 0.92 * lid;
  const wide = 1 + 0.08 * lid;
  const x = side * EYE_X;
  const [ox, oy] = [s.dx + look[0], s.dy + look[1]];
  // The open eye: a rounded rectangle whose corners are as round as it is narrow, traced corner by corner.
  const w = EYE.w * s.sx * wide;
  const h = EYE.h * s.sy * shut * (1 - 0.75 * happy);
  const [cx, cy] = [x + ox, oy - 4 * happy];
  const rr = Math.min(w, h) / 2;
  const [hx, hy] = [w / 2 - rr, h / 2 - rr];
  const outline: [number, number][] = [];
  for (const [qx, qy, from] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]] as const)
    for (let i = 0; i <= 6; i++) {
      const t = ((from + i * 15) * Math.PI) / 180;
      outline.push(project(cx + qx * hx + rr * Math.cos(t), cy + qy * hy + rr * Math.sin(t)));
    }
  // The happy arc: ^, further out than the open eye, squashed with the lid.
  const xh = side * (EYE_X + HAPPY_OUT);
  const [scx, scy] = [s.sx * wide, s.sy * shut * (0.5 + 0.5 * happy)];
  const arc: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const bx = (1 - t) ** 2 * (xh - 10) + 2 * (1 - t) * t * xh + t * t * (xh + 10);
    const by = (1 - t) ** 2 * 6 + 2 * (1 - t) * t * -16 + t * t * 6;
    arc.push(project(x + (bx - x) * scx + ox, by * scy + oy));
  }
  return {
    open: path(outline, true),
    openOpacity: Math.max(0, 1 - happy * 1.6),
    happy: path(arc, false),
    happyOpacity: Math.min(1, Math.max(0, happy * 1.6 - 0.6)),
  };
}

/** Both eyes as drawn (eyeDraw), each fading by its own `opacity`. */
export function Eyes({ eyes, opacity }: { eyes: [EyeDraw, EyeDraw]; opacity: [number, number] }) {
  return (
    <>
      {eyes.map((e, i) => (
        // Each eye in its own group, so its shape can change apart from the other's.
        <g key={i} className="s-eye" opacity={opacity[i]}>
          <path className="s-open" d={e.open} opacity={e.openOpacity} fill={INK} />
          <path className="s-happy" d={e.happy} opacity={e.happyOpacity} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ))}
    </>
  );
}
