// A Sprocket as a solid (ADR 0005, amended): its drawing is the front of a soft, puffy slab with some depth. Facing
// you it's the flat drawing; turned, the front narrows and slides (the eyes a little further, as on a rounded front)
// and the slab's thickness fills out its outline, all in its one colour, with no shading; edge-on it's a sliver, and
// past that its back. It tips up and down the same way. Drawn as layers of the body from back to front, the front one
// with the eyes. Pure geometry: Sprocket.tsx draws it, motion.ts moves it.

/** How a Sprocket stands: turned (`yaw`, degrees, + to the viewer's right), tipped (`pitch`, degrees, + looking
 * up), leaning from its base (`lean`, degrees), squashed (`sx`, `sy`) and lifted off the ground (`hop`, viewBox units). */
export interface Pose {
  yaw: number;
  pitch: number;
  lean: number;
  sx: number;
  sy: number;
  hop: number;
}

/** Where it rests: turned a little, as if glancing at you (three-quarter). Facing you, it's the flat drawing. Done
 * with a message in a team, it turns and leans toward it. */
export const POSES = {
  rest: { yaw: 24, pitch: 0, lean: 0 },
  front: { yaw: 0, pitch: 0, lean: 0 },
  toward: { yaw: 46, pitch: 0, lean: 9 },
} as const;
export type Stance = keyof typeof POSES;

export const poseOf = (stance: Stance): Pose => ({ ...POSES[stance], sx: 1, sy: 1, hop: 0 });

/** The slab's depth, in viewBox units (bodies are about 120 wide). */
const DEPTH = 26;
/** Layers drawn: the back face, the side between, the front face. */
export const LAYERS = 7;
/** How much smaller the faces are than the middle of the side once turned, so the edge reads round. Facing you
 * there's no rounding: the side would show as a rim round the drawing. */
const PUFF = 0.08;
/** How much further the eyes slide than the face they're on, as on a rounded front. */
const SLIDE = 9;
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
  /** The slab seen edge-on: a band as tall as the body, round at its ends, fading in near edge-on (between the
   * layers, which are lines by then). */
  band: { x: number; y: number; width: number; height: number; rx: number; opacity: number };
  eyes: { transform: string; opacity: number };
  shadow: { rx: number; opacity: number };
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const f = (n: number) => +n.toFixed(3);

/**
 * The drawing's transforms for pose `p`, turning about the vertical line x = `axis`. `face` is where the eyes sit
 * on the front, `box` the body's bounds (for the band), `half` its shadow's half-width.
 */
export function layout(p: Pose, axis: number, face: { x: number; y: number }, box: Box, half: number): Layout {
  const a = (p.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const b = (p.pitch * Math.PI) / 180;
  const cp = Math.cos(b);
  const sp = Math.sin(b);
  // Which way the front faces: toward the viewer (c > 0) the front is drawn last, else the back is.
  const toward = c >= 0 ? 1 : -1;
  const mid = box.y + box.height / 2;
  const round = PUFF * clamp(Math.abs(s) * 2.5);
  const layers = Array.from({ length: LAYERS }, (_, i) => {
    const u = (i / (LAYERS - 1)) * 2 - 1; // -1 farthest .. 1 nearest
    const z = (u * toward * DEPTH) / 2; // + toward the front face
    const puff = 1 - round * u * u;
    return `translate(${f(axis + z * s)} ${f(mid - z * sp)}) scale(${f(c * puff)} ${f(cp * puff)}) translate(${f(-axis)} ${f(-mid)})`;
  });
  const end = 1 - round;
  const width = DEPTH * Math.abs(s) * end;
  const eyeX = axis + (face.x - axis) * c * end + (DEPTH / 2) * s + SLIDE * s;
  const eyeY = mid + (face.y - mid) * cp * end - (DEPTH / 2) * sp - SLIDE * sp;
  return {
    rig: `translate(0 ${f(-p.hop)}) rotate(${f(p.lean)} ${axis} ${GROUND}) translate(${axis} ${GROUND}) scale(${f(p.sx)} ${f(p.sy)}) translate(${-axis} ${-GROUND})`,
    layers,
    band: {
      x: f(axis - width / 2),
      y: f(mid - (box.height * end) / 2),
      width: f(width),
      height: f(box.height * end),
      rx: f(Math.min(width / 2, 16)),
      opacity: f(clamp((Math.abs(s) - 0.75) / 0.2)),
    },
    eyes: { transform: `translate(${f(eyeX)} ${f(eyeY)}) scale(${f(Math.max(c, 0.001) * end)} ${f(cp * end)})`, opacity: f(clamp((c - 0.12) / 0.25)) },
    shadow: { rx: f(half * (0.86 + 0.14 * Math.abs(c)) * (1 - clamp(p.hop / 60, 0, 0.5))), opacity: f(1 - clamp(p.hop / 50, 0, 0.5)) },
  };
}
