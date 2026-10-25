// What a Sprocket can do, as data (ADR 0035): gestures (timed changes to where it turns, tips, rolls and looks, with
// kicks to its hop and squash), lean-ins (coming closer to the screen), and expressions and blinks (changes to its
// eyes' shape over time). engine.ts plays them; the director there decides which and when. A random number source is
// passed in, so a clip's choices can be replayed in tests.

export type Rand = () => number;
const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
const side = (rand: Rand) => (rand() < 0.5 ? -1 : 1);
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

// ---- moves ----

/** How a key is reached from the one before: `out` slows into it (rising to the top of a hop), `in` speeds into it
 * (falling to land), `both` eases at each end. */
type Ease = "in" | "out" | "both";
/** At `t` ms the value is `v`, reached from the key before with `ease` (`both` if left out). */
export type Key = [t: number, v: number, ease?: Ease];

/**
 * Body motion as keyframed tracks, played straight off the clock rather than through springs, so what has to happen
 * together does: it squashes the moment it lands, and stretches as it leaves the ground. On top of the pose: `hop`
 * (viewBox units up), `squash` (its width, 1 as drawn; its height is the inverse, so it keeps its volume), `tip`
 * (degrees, + chin up), `shift` (viewBox units, + right), `turn` and `roll` (degrees, + to the viewer's right) and
 * `look` (where the eyes look across, -1 to 1). Each track starts and ends at rest (1 for squash, 0 for the rest).
 */
export interface Moves {
  hop?: Key[];
  squash?: Key[];
  tip?: Key[];
  shift?: Key[];
  turn?: Key[];
  roll?: Key[];
  look?: Key[];
}

const EASES: Record<Ease, (x: number) => number> = {
  in: (x) => x * x,
  out: (x) => 1 - (1 - x) * (1 - x),
  both: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
};

/** A track's value at `t` ms (its first value before it starts, its last after). */
export function sample(keys: Key[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = "both"] = keys[i];
    if (t < t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * EASES[ease]((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * A satisfied nod, a jelly bounce in place: it squashes down with its head dipped, springs up stretched with its chin
 * raised, and floats (half a second in the air); each landing is a quick squash straight into the next, lower hop,
 * three in all, nodding as it lands; then it wobbles slowly to a stop, like jelly.
 */
export const NOD: Moves = {
  hop: [[0, 0], [170, 0], [430, 17, "out"], [690, 0, "in"], [740, 0], [930, 9, "out"], [1120, 0, "in"], [1150, 0], [1260, 3.5, "out"], [1370, 0, "in"]],
  squash: [
    [0, 1], [150, 1.1, "out"], [180, 1.06], [230, 0.9, "out"], [540, 1], [650, 0.97, "in"], // down, up, floating, falling
    [715, 1.1, "out"], [745, 1.06], [790, 0.93, "out"], [1000, 1], [1090, 0.98, "in"], // lands, and up again
    [1145, 1.07, "out"], [1180, 1.04], [1220, 0.97, "out"], [1370, 1], // lands, and a little hop
    [1405, 1.07, "out"], [1630, 0.95], [1850, 1.03], [2050, 0.99], [2250, 1], // lands, and the jelly wobble
  ],
  tip: [[0, 0], [150, -5, "out"], [430, 9], [710, -8, "out"], [930, 5], [1140, -5, "out"], [1260, 2], [1400, -3, "out"], [1750, 0]],
};

// ---- gestures ----

/**
 * One step of a gesture, held for `ms`: where it turns (`turn`, degrees, + to the viewer's right), tips (`tip`, + up),
 * rolls (`roll`) and moves aside (`shift`, viewBox units, + right), and where its eyes look (`aim`, -1 to 1 each way,
 * null for ahead). A field left out keeps its
 * value from the step before. `hop` and `squash` kick those springs, `spin` adds a whole turn either way, and `face`
 * plays an expression.
 */
export interface Step {
  ms: number;
  turn?: number;
  tip?: number;
  roll?: number;
  shift?: number;
  aim?: [number, number] | null;
  hop?: number;
  squash?: number;
  spin?: 1 | -1;
  face?: ExpressionName;
}

/** A gesture: a list of steps, drawn fresh (with new random values) each time it plays. */
export type Gesture = (rand: Rand) => Step[];

/** All four set, as a thinking move's step does: turned, tipped, rolled, looking. */
const pose = (ms: number, turn: number, tip: number, roll: number, aim: [number, number] | null): Step => ({ ms, turn, tip, roll, aim });

/**
 * What a thinking Sprocket does, one after another, never the same twice running: pondering upward, looking one way
 * then the other, peeking round, nodding, tilting its head (a roll), a bounce, a scrunch (its eyes squeezing, going
 * round or one big), and now and then a spin. Each takes a second or two; `weight` is how often it comes up.
 */
export const THINKING: Record<string, { weight: number; steps: Gesture }> = {
  ponder: {
    weight: 3,
    steps: (r) => {
      const s = side(r);
      return [pose(between(r, 1100, 1700), s * between(r, 8, 16), between(r, 16, 24), s * between(r, 6, 12), [s * 0.4, -0.9]), pose(between(r, 500, 900), s * 4, between(r, 6, 10), s * 3, [0, -0.5])];
    },
  },
  look: {
    weight: 3,
    steps: (r) => {
      const s = side(r);
      return [pose(between(r, 700, 1000), s * between(r, 30, 42), between(r, -2, 6), s * 5, [s * 0.8, -0.1]), pose(between(r, 700, 1000), -s * between(r, 30, 42), between(r, -2, 6), -s * 5, [-s * 0.8, -0.1])];
    },
  },
  peek: {
    weight: 2,
    steps: (r) => {
      const s = side(r);
      return [pose(between(r, 900, 1300), s * between(r, 50, 60), between(r, -10, -4), s * 10, [s, 0.2]), pose(400, s * 10, 0, 0, null)];
    },
  },
  nod: {
    weight: 2,
    steps: (r) => [
      pose(320, between(r, -8, 8), -14, 0, [0, 0.5]),
      { ms: 320, tip: 8, roll: 0, aim: [0, -0.3] },
      { ms: 320, tip: -12, roll: 0, aim: [0, 0.4] },
      { ms: 600, tip: 4, roll: 0, aim: null },
    ],
  },
  tilt: {
    weight: 2,
    steps: (r) => {
      const s = side(r);
      return [pose(700, s * 10, 6, s * 22, [s * 0.5, -0.5]), pose(700, -s * 6, 6, -s * 16, [-s * 0.4, -0.5]), pose(400, 0, 0, 0, null)];
    },
  },
  bounce: {
    weight: 2,
    steps: (r) => [
      { ms: 260, squash: -2.4, tip: 0, roll: 0, aim: [0, 0.2] },
      { ms: 700, hop: between(r, 170, 220), squash: 3, tip: 10, roll: 0, aim: [0, -0.6] },
      { ms: 500, tip: 0, roll: 0, aim: null },
    ],
  },
  scrunch: {
    weight: 1.5,
    steps: (r) => [
      { ...pose(900, between(r, -12, 12), between(r, -4, 6), side(r) * 4, null), face: pick(r, ["squeeze", "curious", "wide", "dots"]) },
      { ms: 500, tip: 0, roll: 0, aim: null },
    ],
  },
  spin: {
    weight: 0.6,
    steps: (r) => [{ ...pose(1300, 0, 6, 0, [0, -0.4]), spin: side(r) as 1 | -1, hop: 150 }, pose(400, 0, 0, 0, null)],
  },
};

/** At rest: a glance aside, held a moment, now and then with the eyes changing shape; then back. */
export const GLANCE: Gesture = (r) => {
  const s = side(r);
  const step: Step = { ms: between(r, 700, 1600), turn: s * between(r, 10, 24), tip: between(r, -6, 8), aim: [s * between(r, 0.4, 0.8), between(r, -0.4, 0.3)] };
  if (r() < 0.2) step.face = pick(r, Object.keys(EXPRESSIONS) as ExpressionName[]);
  return [step, { ms: 0, turn: 0, tip: 0, aim: null }];
};

/** Starting to write: one whole turn, with a hop. */
export const SPIN: Gesture = () => [{ ms: 0, spin: 1, hop: 240 }];
/** How long the spin takes (SprocketChat holds the typing dots back until it's done). */
export const SPIN_MS = 700;

/**
 * Cheering, as its message lands: a jelly dance from side to side, timed like the satisfied nod. It squashes down,
 * then floats over to one side and back, four hops, each a little lower, leaning and turning the way it's going with
 * its eyes leading; each landing is a quick squash straight into the next hop, the last one back to the middle, and
 * it wobbles slowly to a stop.
 */
export const DANCE: Moves = (() => {
  const hops: [to: number, up: number, air: number][] = [[-11, 15, 440], [11, 14, 440], [-11, 12, 420], [0, 8, 360]];
  const LAND = 60; // on the ground between hops: a quick squash
  const m: Required<Moves> = { hop: [[0, 0], [160, 0]], squash: [[0, 1], [150, 1.1, "out"], [160, 1.08]], tip: [[0, 0], [150, -4, "out"]], shift: [[0, 0]], turn: [[0, 0]], roll: [[0, 0]], look: [[0, 0]] };
  let [t, at] = [160, 0];
  for (const [to, up, air] of hops) {
    const dir = Math.sign(to - at);
    m.squash.push([t + 50, 0.9, "out"], [t + air * 0.6, 1], [t + air - 20, 0.97, "in"], [t + air + 30, 1.1, "out"], [t + air + LAND, 1.06]);
    m.hop.push([t + air / 2, up, "out"], [t + air, 0, "in"], [t + air + LAND, 0]);
    m.shift.push([t, at], [t + air, to]);
    m.turn.push([t + air * 0.4, dir * 14]);
    m.roll.push([t + air * 0.4, dir * 9], [t + air + 40, dir * 3]);
    m.look.push([t + air * 0.3, dir * 0.6]);
    m.tip.push([t + air / 2, 6], [t + air + 30, -5, "out"]);
    [t, at] = [t + air + LAND, to];
  }
  m.squash.push([t + 220, 0.95], [t + 440, 1.03], [t + 640, 0.99], [t + 820, 1]); // the jelly wobble
  m.turn.push([t + 300, 0]);
  m.roll.push([t + 150, -2], [t + 400, 0]);
  m.look.push([t + 300, 0]);
  m.tip.push([t + 350, 0]);
  return m;
})();

/**
 * Surveying what's below: a pause at one end, then its eyes scanning along an upside-down arc (∪), from one side down
 * through the middle to the other and back, its body tipped down a little and turning after them.
 */
export const SURVEY: Gesture = () => {
  const POINTS = 8;
  const sweep = (from: number): Step[] =>
    Array.from({ length: POINTS }, (_, i) => {
      const x = from * (1 - (2 * (i + 1)) / POINTS);
      return { ms: 125, aim: [x, 0.25 + 0.6 * (1 - x * x)], turn: x * 12, tip: -8, roll: x * 3 };
    });
  return [{ ms: 380, aim: [-1, 0.25], turn: -12, tip: -8, roll: -3 }, ...sweep(-1), { ms: 200 }, ...sweep(1)];
};

// ---- leaning in ----

/**
 * Leaning in: it comes closer to the screen (how much bigger it looks), glancing to the viewer's left as it does,
 * and goes back, in one of a few shapes, each a list of [nearness, ms held]. The last step (back) settles for 900ms
 * before the next wait.
 */
export const LEANS: ((r: Rand) => [number, number][])[] = [
  // In, hold, back.
  (r) => [[between(r, 0.11, 0.15), between(r, 900, 1500)], [0, 900]],
  // In, then a pulse or two there.
  (r) => [[0.14, 700], [0.08, 450], [0.14, 500], ...(r() < 0.5 ? ([[0.08, 450], [0.14, 500]] as [number, number][]) : []), [0, 900]],
  // A long, slow breath in and out.
  () => [[0.1, 1400], [0.06, 600], [0.1, 900], [0, 900]],
];
/** How far it glances while leaning in: a turn to the viewer's left, its body and eyes moving that way a little. */
export const LEAN_GLANCE = { turn: [-30, -20], slide: -6, aim: -0.6 } as const;

// ---- the eyes ----

/** One eye's change from how it's drawn: moved (`dx`, `dy`, viewBox units) and sized (`sx`, `sy`) about its centre. */
export interface EyeShape {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}
export const OPEN: EyeShape = { dx: 0, dy: 0, sx: 1, sy: 1 };

/** A cubic-bezier timing curve, as CSS defines it. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const linear = (t: number) => t;
const easeOut = bezier(0, 0, 0.58, 1);
/** Playful: arrivals overshoot about 10%. */
const easeBack = bezier(0.34, 1.56, 0.64, 1);

/** A keyframe of one eye: at `at` (0 to 1 of the expression), its shape, eased from the keyframe before by `ease`. */
interface EyeKey {
  at: number;
  shape: EyeShape;
  ease?: (t: number) => number;
}
/** An expression: each eye's keyframes, and how long it lasts. */
export interface Expression {
  left: EyeKey[];
  right: EyeKey[];
  ms: number;
}

const shape = (s: Partial<EyeShape>): EyeShape => ({ ...OPEN, ...s });
/** Into a shape, held, and back with an overshoot. */
const held = (s: Partial<EyeShape>): EyeKey[] => [
  { at: 0, shape: OPEN },
  { at: 0.25, shape: shape(s) },
  { at: 0.7, shape: shape(s) },
  { at: 1, shape: OPEN, ease: easeBack },
];
const still: EyeKey[] = [{ at: 0, shape: OPEN }, { at: 1, shape: OPEN }];

/** The eyes changing shape for a moment. */
export const EXPRESSIONS = {
  // Both squeeze in together and squash: a cute scrunch.
  squeeze: () => ({ left: held({ dx: 5, dy: 1, sx: 1.25, sy: 0.5 }), right: held({ dx: -5, dy: 1, sx: 1.25, sy: 0.5 }), ms: 900 }),
  // Round dots.
  dots: () => ({ left: held({ sy: 0.42 }), right: held({ sy: 0.42 }), ms: 1000 }),
  // Wide open.
  wide: () => ({ left: held({ sx: 1.25, sy: 1.22 }), right: held({ sx: 1.25, sy: 1.22 }), ms: 750 }),
  // A happy squint.
  squint: () => ({ left: held({ dy: -1, sx: 1.15, sy: 0.3 }), right: held({ dy: -1, sx: 1.15, sy: 0.3 }), ms: 1000 }),
  // One eye shuts.
  wink: (r: Rand) => (r() < 0.5 ? { left: held({ sx: 1.1, sy: 0.12 }), right: still, ms: 650 } : { left: still, right: held({ sx: 1.1, sy: 0.12 }), ms: 650 }),
  // One eye big, the other small: curious.
  curious: (r: Rand) => {
    const [big, small] = [held({ sx: 1.3, sy: 1.3 }), held({ sx: 0.78, sy: 0.78 })];
    return r() < 0.5 ? { left: big, right: small, ms: 1100 } : { left: small, right: big, ms: 1100 };
  },
  // Stretch, squash, settle: excited.
  bounce: () => {
    const keys: EyeKey[] = [
      { at: 0, shape: OPEN },
      { at: 0.2, shape: shape({ sx: 0.85, sy: 1.3 }) },
      { at: 0.45, shape: shape({ sx: 1.2, sy: 0.72 }) },
      { at: 0.7, shape: shape({ sx: 0.96, sy: 1.08 }) },
      { at: 1, shape: OPEN },
    ];
    return { left: keys, right: keys, ms: 600 };
  },
} satisfies Record<string, (r: Rand) => Expression>;
export type ExpressionName = keyof typeof EXPRESSIONS;

/** One eye's shape `t` ms into an expression (the whole run eased out, as each keyframe eases from the one before). */
export function eyeAt(keys: EyeKey[], t: number, ms: number): EyeShape {
  const p = easeOut(Math.min(1, Math.max(0, t / ms)));
  const i = keys.findIndex((k) => k.at >= p);
  if (i <= 0) return keys[0].shape;
  const [a, b] = [keys[i - 1], keys[i]];
  const u = (b.ease ?? linear)((p - a.at) / (b.at - a.at));
  const mix = (x: number, y: number) => x + (y - x) * u;
  return { dx: mix(a.shape.dx, b.shape.dx), dy: mix(a.shape.dy, b.shape.dy), sx: mix(a.shape.sx, b.shape.sx), sy: mix(a.shape.sy, b.shape.sy) };
}

/**
 * A blink, as how shut the lids are (0 open, 1 shut) `t` ms in: they close quickly, rest shut a beat and open
 * softly, over BLINK_MS. Blinks come 2–5.5s apart, sometimes two together.
 */
export const BLINK_MS = 300;
const closing = bezier(0.5, 0, 0.9, 0.6);
const opening = bezier(0.2, 0.7, 0.3, 1);
export function lidAt(t: number): number {
  const p = t / BLINK_MS;
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.32) return closing(p / 0.32);
  if (p < 0.45) return 1;
  return 1 - opening((p - 0.45) / 0.55);
}

