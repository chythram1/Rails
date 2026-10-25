// A Sprocket as a solid (ADR 0005, amended): its drawing is the front of a body with its own thickness and roundness
// (characters.ts `depth`, `puff`): a pizza box is thin with straight sides, a bean deep and soft. Facing you it's the
// flat drawing, its eyes upright. Turned or tipped it's seen in true perspective: a thin body narrows to a sliver,
// while a deep, round one stays round, its depth filling out the outline, all in its one colour with no shading. The
// eyes ride its front, travelling further on a deep body, and slant as they would on a dome (looking up and to the
// right, the pair rises to the right and each eye's top leans left). Drawn as layers of the body from back to front,
// each a slice of it, the front one with the eyes. Pure geometry: Sprocket.tsx draws it, motion.ts moves it.

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

/** How many slices of the body are drawn, back to front: about one every 4 units of depth, so a deep body's edge
 * stays smooth (at least 5, and an odd number, so one is its middle). */
export const layerCount = (body: Body) => Math.max(5, Math.round(body.depth / 8) * 2 + 1);
/** How much the eyes' pair turns with a look up and aside, in degrees per unit of sin(yaw)·sin(pitch). */
const PAIR = 30;
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
  /** The body seen edge-on (in a spin): a band as tall as the body, round at its ends as the body is, fading in near
   * edge-on (between the layers, which are lines by then). */
  band: { x: number; y: number; width: number; height: number; rx: number; opacity: number };
  /** Where the eyes sit and how the pair turns; `slant` turns each eye about its own centre (degrees). */
  eyes: { transform: string; opacity: number; slant: number };
  shadow: { rx: number; opacity: number };
}

/** A body's thickness and roundness (characters.ts). */
export interface Body {
  depth: number;
  puff: number;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const f = (n: number) => +n.toFixed(3);

/**
 * The drawing's transforms for pose `p`, turning about the vertical line x = `axis`. `face` is where the eyes sit
 * on the front, `box` the body's bounds, `half` its shadow's half-width, `body` its thickness and roundness.
 */
export function layout(p: Pose, axis: number, face: { x: number; y: number }, box: Box, half: number, body: Body): Layout {
  const a = (p.yaw * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const b = (p.pitch * Math.PI) / 180;
  const cp = Math.cos(b);
  const sp = Math.sin(b);
  // Which way the front faces: toward the viewer (c > 0) the front is drawn last, else the back is.
  const toward = c >= 0 ? 1 : -1;
  const mid = box.y + box.height / 2;
  const depth = body.depth / 2;
  // A slice's size at u (-1 back, 0 middle, 1 front): an ellipse through 1 - puff at the faces, so the sides curve.
  const k = 1 - (1 - body.puff) ** 2;
  const n = layerCount(body);
  const layers = Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * 2 - 1; // -1 farthest .. 1 nearest
    const z = u * toward * depth; // + toward the front face
    const size = Math.sqrt(1 - k * u * u);
    return `translate(${f(axis + z * s)} ${f(mid - z * sp)}) scale(${f(c * size)} ${f(cp * size)}) translate(${f(-axis)} ${f(-mid)})`;
  });
  // The face rides the front, and the eyes narrow with it (less on a round body, whose front is a dome).
  const eyeX = axis + (face.x - axis) * c + depth * s;
  const eyeY = mid + (face.y - mid) * cp - depth * sp;
  const flat = 1 - body.puff;
  const width = body.depth * Math.abs(s);
  return {
    rig: `translate(0 ${f(-p.hop)}) rotate(${f(p.lean)} ${axis} ${GROUND}) rotate(${f(p.roll)} ${axis} ${f(mid)}) translate(${axis} ${f(mid)}) scale(${f(p.near)}) translate(${-axis} ${f(-mid)}) translate(${axis} ${GROUND}) scale(${f(p.sx)} ${f(p.sy)}) translate(${-axis} ${-GROUND})`,
    layers,
    band: {
      x: f(axis - width / 2),
      y: f(mid - (box.height * cp) / 2),
      width: f(width),
      height: f(box.height * cp),
      rx: f(Math.min(width / 2, 4 + body.puff * 90)),
      opacity: f(clamp((Math.abs(s) - 0.85) / 0.12)),
    },
    eyes: {
      transform: `translate(${f(eyeX)} ${f(eyeY)}) rotate(${f(-PAIR * s * sp)}) scale(${f(Math.max(c, 0.001) ** flat)} ${f(Math.max(cp, 0.001) ** flat)})`,
      opacity: f(clamp((c - 0.15) / 0.25)),
      // The face's "up" on a dome turned by yaw then pitch, seen from the front.
      slant: f((Math.atan2(-s * sp, cp) * 180) / Math.PI),
    },
    shadow: { rx: f(half * (0.9 + 0.1 * Math.abs(c)) * (1 - clamp(p.hop / 60, 0, 0.5))), opacity: f(1 - clamp(p.hop / 50, 0, 0.5)) },
  };
}
