// What a Sprocket can do, as data (ADR 0035): gestures (timed changes to where it turns, tips, rolls and looks, with
// kicks to its hop and squash), lean-ins (coming closer to the screen), and expressions and blinks (changes to its
// eyes' shape over time). engine.ts plays them; the director there decides which and when. A random number source is
// passed in, so a clip's choices can be replayed in tests.

export type Rand = () => number;
const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
const side = (rand: Rand) => (rand() < 0.5 ? -1 : 1);
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

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
 * Cheering, as its message lands: a dance, bouncing side to side. Each bounce hops it over to one side, stretching as it
 * takes off and squashing as it lands, leaning and turning the way it's going with its eyes leading; four bounces,
 * then back to the middle.
 */
export const DANCE: Gesture = () => [
  ...[-1, 1, -1, 1].flatMap((s): Step[] => [
    { ms: 210, shift: s * 11, turn: s * 14, roll: s * 9, aim: [s * 0.5, -0.4], hop: 320, squash: -1.6 },
    { ms: 190, squash: 1.8, roll: s * 4 },
  ]),
  { ms: 300, shift: 0, turn: 0, roll: 0, aim: null },
];

/**
 * Surveying what's below: a pause at one end, then its eyes scanning along an upside-down arc (∪), from one side down
 * through the middle to the other and back, its body tipped down a little and turning after them. It ends where it
 * starts, so it can repeat.
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

