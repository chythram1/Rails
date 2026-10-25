// A Sprocket as a solid (ADR 0005, amended): its drawing is the front of a body with its own thickness and roundness
// (characters.ts `depth`, `puff`): a pizza box is thin with straight sides, a bell deep and soft. A round body is
// spun (`spun`): a solid turned about its upright middle, like a ball, whose outline stays put as it turns. It's turned as a
// solid in 3D, tipped then turned then rolled (as Grok's bots are), and seen straight on (no vanishing point): facing
// you it's the flat drawing, its eyes upright; turned and tipped, a flat body shears into a parallelogram while a
// deep, round one stays round, its depth filling out the outline, all in its one colour with no shading. Drawn as
// slices of the body from back to front. The eyes are painted on its front, which curves as much as the body is
// round (`puff`): every point of an eye is placed on that surface, turned with the body and projected, so the eye on
// the far side narrows and bends as on a ball, and the slant they show comes from the turn alone. Pure geometry:
// Sprocket.tsx draws it, motion.ts moves it.

/** How a Sprocket stands: turned (`yaw`, degrees, + to the viewer's right), tipped (`pitch`, degrees, + looking
 * up), rolled about its middle (`roll`, degrees), how near the screen it's come (`near`, a scale, 1 where it stands),
 * leaning from its base (`lean`, degrees), squashed (`sx`, `sy`), lifted off the ground (`hop`, viewBox units) and
 * moved aside (`slide`, viewBox units, + to the viewer's right). */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
  near: number;
  lean: number;
  sx: number;
  sy: number;
  hop: number;
  slide: number;
}

/** Where it rests, beside its messages too: turned up and to the viewer's right, rolled a little to the left, its face
 * to the upper right (Grok's bots' resting pose: tipped 16° up, turned 33°, rolled 16°, measured on its square's and
 * tablet's edges; rolled further, a flat body looks like it's lying on its back).
 * Facing you, it's the flat drawing. */
export const POSES = {
  rest: { yaw: 33, pitch: 16, roll: -16, lean: 0 },
  front: { yaw: 0, pitch: 0, roll: 0, lean: 0 },
} as const;
export type Stance = keyof typeof POSES;

export const poseOf = (stance: Stance): Pose => ({ ...POSES[stance], near: 1, sx: 1, sy: 1, hop: 0, slide: 0 });

/** How many slices of the body are drawn, back to front: about one every 4 units of depth, so a deep body's edge
 * stays smooth (at least 5, and an odd number, so one is its middle). Turned well aside (`turned`), where the
 * slices are narrow and their rounded tops would show as scallops along its side, one every 1.5 units. */
export const layerCount = (body: Body, turned = false) =>
  turned ? Math.max(9, Math.round(body.depth / 3) * 2 + 1) : Math.max(5, Math.round(body.depth / 8) * 2 + 1);
/** How far aside (|sin yaw|) it is when it draws the denser slices: they overlap so much there that the change
 * doesn't show. */
const TURNED = 0.3;
const GROUND = 200;
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  rig: string;
  /** Each slice's transform (an SVG matrix), back to front as drawn. The first and last are the faces. */
  layers: string[];
  /** How wide each layer's stroke in its colour is (viewBox units), so turned toward edge-on, where layers are
   * slivers, they join into one smooth side instead of a comb: a little over the gap between neighbours, up to twice
   * it edge-on, where their round ends must overlap well to make one curve. Facing you it's 0: the drawing as it is. */
  gap: number;
  /** The eyes: `project` takes a point on the face, drawn upright from the face's centre (viewBox units, y down), to
   * where it's seen; `opacity` is each eye's (left, right), fading as its side of the face turns away. */
  eyes: { project: (x: number, y: number) => [number, number]; opacity: [number, number] };
  shadow: { rx: number; opacity: number };
}

/** A body's thickness and roundness, and how spun it is (characters.ts): 1 a solid turned about its upright middle,
 * whose outline stays put as it turns; 0 a slab of its outline. */
export interface Body {
  depth: number;
  puff: number;
  spun?: number;
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const f = (n: number) => +n.toFixed(3);

/** Distance from the face's centre to each eye (parts.tsx draws them there). */
export const EYE_X = 14.5;

/**
 * The drawing's transforms for pose `p`, turning about the vertical line x = `axis`. `face` is where the eyes sit
 * on the front, `box` the body's bounds, `half` its shadow's half-width, `body` its thickness and roundness.
 */
export function layout(p: Pose, axis: number, face: { x: number; y: number }, box: Box, half: number, body: Body): Layout {
  const a = (p.yaw * Math.PI) / 180;
  const b = (p.pitch * Math.PI) / 180;
  // Never quite edge-on: a slice squashed to nothing wouldn't draw (its stroke makes the sliver).
  const nudge = (v: number) => (Math.abs(v) < 0.002 ? (v < 0 ? -0.002 : 0.002) : v);
  const [ca, sa, cp, sp] = [nudge(Math.cos(a)), Math.sin(a), nudge(Math.cos(b)), Math.sin(b)];
  // A spun body (a ball, a bell) looks the same from every side as it turns: its slices take only the tip, and the
  // turn shows in its eyes going round (below). In between, part of the turn.
  const spun = body.spun ?? 0;
  const ls = Math.sin(a * (1 - spun));
  const lc = nudge(Math.cos(a * (1 - spun)));
  // Tipped up by the pitch, then turned by the yaw, in a frame with y up and z toward you; rows of the rotation.
  const R = [
    [ca, -sa * sp, sa * cp],
    [0, cp, sp],
    [-sa, -ca * sp, ca * cp],
  ];
  // The slices' rotation: R, with only the unspun part of the turn.
  const S = [
    [lc, -ls * sp, ls * cp],
    [0, cp, sp],
    [-ls, -lc * sp, lc * cp],
  ];
  // Which way the front faces: toward the viewer the front is drawn last, else the back is.
  const toward = S[2][2] >= 0 ? 1 : -1;
  const mid = box.y + box.height / 2;
  const depth = body.depth / 2;
  // A slice's size at u (-1 back, 0 middle, 1 front): an ellipse through 1 - puff at the faces, so the sides curve.
  const k = 1 - (1 - body.puff) ** 2;
  const n = layerCount(body, Math.abs(ls) > TURNED);
  const layers = Array.from({ length: n }, (_, i) => {
    const u = (i / (n - 1)) * 2 - 1; // -1 farthest .. 1 nearest
    const z = u * toward * depth; // + toward the front face
    const size = Math.sqrt(1 - k * u * u);
    // (x, y) on the drawing to the screen: x' = axis + R0·(x - axis, mid - y, z), y' = mid - R1·(…).
    const [ma, mb, mc, md] = [S[0][0] * size, -S[1][0] * size, -S[0][1] * size, S[1][1] * size];
    const e = axis + S[0][2] * z - ma * axis - mc * mid;
    const f_ = mid - S[1][2] * z - mb * axis - md * mid;
    const q = (v: number) => +v.toFixed(5); // the scales finer, or a slice's middle drifts off the axis
    return `matrix(${q(ma)} ${q(mb)} ${q(mc)} ${q(md)} ${f(e)} ${f(f_)})`;
  });
  // The front's curve: a dome as round as the body (a sphere through its edges for the roundest, flat for a box),
  // centred on the face, so the eyes sit either side of its top and stay parallel (on a face below the body's middle,
  // as Drop's is, centred there they'd tip toward each other).
  const r = (box.width / 2) / Math.max(0.001, Math.min(1, body.puff * 2.5));
  const [fx, fy] = [face.x - axis, mid - face.y];
  const onFront = (x: number, y: number): [number, number, number] => {
    if (body.puff <= 0) return [fx + x, fy + y, depth];
    const [u, v] = [x / r, y / r];
    return [fx + r * Math.sin(u) * Math.cos(v), fy + r * Math.sin(v), depth + r * (Math.cos(u) * Math.cos(v) - 1)];
  };
  const turn = ([x, y, z]: [number, number, number]): [number, number, number] => [
    R[0][0] * x + R[0][1] * y + R[0][2] * z,
    R[1][0] * x + R[1][1] * y + R[1][2] * z,
    R[2][0] * x + R[2][1] * y + R[2][2] * z,
  ];
  const project = (x: number, y: number): [number, number] => {
    const [X, Y] = turn(onFront(x, -y));
    return [axis + X, mid - Y];
  };
  // Each eye fades as its side of the face turns away: its surface's facing, from how the dome slopes there.
  const facing = (side: number) => {
    const u = (side * EYE_X) / r;
    const nrm: [number, number, number] = body.puff <= 0 ? [0, 0, 1] : [Math.sin(u), 0, Math.cos(u)];
    return f(clamp((turn(nrm)[2] - 0.15) / 0.25));
  };
  return {
    rig: `translate(${f(p.slide)} ${f(-p.hop)}) rotate(${f(p.lean)} ${axis} ${GROUND}) rotate(${f(p.roll)} ${axis} ${f(mid)}) translate(${axis} ${f(mid)}) scale(${f(p.near)}) translate(${-axis} ${f(-mid)}) translate(${axis} ${GROUND}) scale(${f(p.sx)} ${f(p.sy)}) translate(${-axis} ${-GROUND})`,
    layers,
    gap: f((body.depth / (n - 1)) * Math.hypot(ls, sp) * (1.15 + 0.85 * ls * ls)),
    eyes: { project, opacity: [facing(-1), facing(1)] },
    shadow: { rx: f(half * (0.9 + 0.1 * Math.abs(lc)) * (1 - clamp(p.hop / 60, 0, 0.5))), opacity: f(1 - clamp(p.hop / 50, 0, 0.5)) },
  };
}
