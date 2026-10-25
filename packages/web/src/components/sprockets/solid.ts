// A Sprocket as a solid (ADR 0005, amended): its drawing is the front of a soft, round body. Facing you it's the flat
// drawing, its eyes upright. Turned or tipped, the body hardly narrows: its face moves instead, the eyes travelling a
// little toward where it looks and slanting as they would on a dome (looking up and to the right, the pair rises to
// the right and each eye's top leans left), while its thickness, in its one colour with no
// shading, swells the outline on the far side. Only a spin takes it through edge-on, a sliver, to its back. Drawn as
// layers of the body from back to front, the front one with the eyes. Pure geometry: Sprocket.tsx draws it, motion.ts
// moves it.

/** How a Sprocket stands: turned (`yaw`, degrees, + to the viewer's right), tipped (`pitch`, degrees, + looking
 * up), rolled about its middle (`roll`, degrees), how near the screen it's come (`near`, a scale, 1 where it stands),
 * leaning from its base (`lean`, degrees), squashed (`sx`, `sy`) and lifted off the ground (`hop`, viewBox units). */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  near: number;
  lean: number;
  sx: number;
  sy: number;
  hop: number;
}

/** Where it rests: almost facing you, glancing up a little. Facing you, it's the flat drawing. Done with a message
 * in a team, it looks up toward it, rocking back a little. */
export const POSES = {
  rest: { yaw: 6, pitch: 6, lean: 0 },
  front: { yaw: 0, pitch: 0, lean: 0 },
  toward: { yaw: 40, pitch: 26, lean: -6 },
} as const;
export type Stance = keyof typeof POSES;

export const poseOf = (stance: Stance): Pose => ({ ...POSES[stance], roll: 0, near: 1, sx: 1, sy: 1, hop: 0 });

/** The body's depth, in viewBox units (bodies are about 120 wide). */
const DEPTH = 22;
/** Layers drawn: the back face, the depth between, the front face. */
export const LAYERS = 7;
/** How far the face travels across the body as it turns, as a share of the body's half-width (and half-height for
 * tipping). */
const TRAVEL = 0.45;
/** How much the eyes' pair turns with a look up and aside, in degrees per unit of sin(yaw)·sin(pitch). */
const PAIR = 30;
/** How little a turn narrows the body: its width goes as cos^SOFT, so small turns barely show and a spin still
 * passes through a sliver. */
const SOFT = 0.35;
const GROUND = 200;
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  rig: string;
  /** Each layer's transform, back to front as drawn. The first and last are the faces. */
  layers: string[];
  /** The body seen edge-on (in a spin): a band as tall as the body, round at its ends, fading in near edge-on
   * (between the layers, which are lines by then). */
  band: { x: number; y: number; width: number; height: number; rx: number; opacity: number };
  /** Where the eyes sit and how the pair turns; `slant` turns each eye about its own centre (degrees). */
  eyes: { transform: string; opacity: number; slant: number };
  shadow: { rx: number; opacity: number };
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const f = (n: number) => +n.toFixed(3);
const soft = (c: number) => Math.sign(c) * Math.abs(c) ** SOFT;

/**
 * The drawing's transforms for pose `p`, turning about the vertical line x = `axis`. `face` is where the eyes sit
 * on the front, `box` the body's bounds, `half` its shadow's half-width.
 */
export function layout(p: Pose, axis: number, face: { x: number; y: number }, box: Box, half: number): Layout {
  const a = (p.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const b = (p.pitch * Math.PI) / 180;
  const cp = Math.cos(b);
  const sp = Math.sin(b);
  const w = soft(c);
  const h = soft(cp);
  // Which way the front faces: toward the viewer (c > 0) the front is drawn last, else the back is.
  const toward = c >= 0 ? 1 : -1;
  const mid = box.y + box.height / 2;
  const layers = Array.from({ length: LAYERS }, (_, i) => {
    const u = (i / (LAYERS - 1)) * 2 - 1; // -1 farthest .. 1 nearest
    const z = (u * toward * DEPTH) / 2; // + toward the front face
    return `translate(${f(axis + z * s)} ${f(mid - z * sp)}) scale(${f(w)} ${f(h)}) translate(${f(-axis)} ${f(-mid)})`;
  });
  // The face travels across the front toward where it looks, and its eyes narrow as they near the edge.
  const eyeX = axis + (face.x - axis) * w + (box.width / 2) * TRAVEL * s * Math.abs(w);
  const eyeY = mid + (face.y - mid) * h - (box.height / 2) * TRAVEL * sp;
  const width = DEPTH * Math.abs(s);
  return {
    rig: `translate(0 ${f(-p.hop)}) rotate(${f(p.lean)} ${axis} ${GROUND}) rotate(${f(p.roll)} ${axis} ${f(mid)}) translate(${axis} ${f(mid)}) scale(${f(p.near)}) translate(${-axis} ${f(-mid)}) translate(${axis} ${GROUND}) scale(${f(p.sx)} ${f(p.sy)}) translate(${-axis} ${-GROUND})`,
    layers,
    band: {
      x: f(axis - width / 2),
      y: f(mid - (box.height * h) / 2),
      width: f(width),
      height: f(box.height * h),
      rx: f(Math.min(width / 2, 16)),
      opacity: f(clamp((Math.abs(s) - 0.85) / 0.12)),
    },
    eyes: {
      transform: `translate(${f(eyeX)} ${f(eyeY)}) rotate(${f(-PAIR * s * sp)}) scale(${f(Math.max(c, 0.001) ** 0.6)} ${f(Math.max(cp, 0.001) ** 0.6)})`,
      opacity: f(clamp((c - 0.15) / 0.25)),
      // The face's "up" on a dome turned by yaw then pitch, seen from the front.
      slant: f((Math.atan2(-s * sp, cp) * 180) / Math.PI),
    },
    shadow: { rx: f(half * (0.9 + 0.1 * Math.abs(w)) * (1 - clamp(p.hop / 60, 0, 0.5))), opacity: f(1 - clamp(p.hop / 50, 0, 0.5)) },
  };
}
