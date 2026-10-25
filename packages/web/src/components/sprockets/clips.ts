// What a Sprocket can do, as data (ADR 0035): gestures (timed changes to where it turns, tips, rolls and looks, with
// kicks to its hop and squash), lean-ins (coming closer to the screen), and expressions and blinks (changes to its
// eyes' shape over time). engine.ts plays them; the director there decides which and when. A random number source is
// passed in, so a clip's choices can be replayed in tests.

export type Rand = () => number;
const between = (rand: Rand, a: number, b: number) => a + rand() * (b - a);
const side = (rand: Rand) => (rand() < 0.5 ? -1 : 1);
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** One eye's change from how it's drawn: moved (`dx`, `dy`, viewBox units) and sized (`sx`, `sy`) about its centre. */
export interface EyeShape {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}
export const OPEN: EyeShape = { dx: 0, dy: 0, sx: 1, sy: 1 };

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
 * (degrees, + chin up), `shift` (viewBox units, + right), `turn` and `roll` (degrees, + to the viewer's right), `near`
 * (how close it comes, 1 as drawn), and where the eyes look (`look` across, `lookY` down, -1 to 1). Each track starts
 * and ends at rest (1 for squash and near, 0 for the rest). `eyes` holds a face from each key's time on, blending into
 * it over FACE_MS (end on `open`); `blinks` are when it blinks, its only blinks while it plays (none if left out), so
 * a blink never lands on a face it didn't plan for, and two Sprockets playing it stay exactly alike.
 */
export interface Moves {
  hop?: Key[];
  squash?: Key[];
  tip?: Key[];
  shift?: Key[];
  turn?: Key[];
  roll?: Key[];
  near?: Key[];
  look?: Key[];
  lookY?: Key[];
  eyes?: [t: number, face: FaceName][];
  blinks?: number[];
}

/** A face held for a while: each eye's shape, and whether it's the happy arcs or dilated circles. */
export interface Face {
  left: EyeShape;
  right: EyeShape;
  happy?: boolean;
  round?: boolean;
}
const both = (s: Partial<EyeShape>): Face => ({ left: { ...OPEN, ...s }, right: { ...OPEN, ...s } });
/** How long a face takes to blend into the next. */
export const FACE_MS = 220;
export const FACES = {
  open: both({}),
  /** Surprised: wide open. */
  wide: both({ sx: 1.15, sy: 1.12 }),
  /** Concentrating: narrowed, a touch raised. */
  squint: both({ dy: -1, sx: 1.45, sy: 0.3 }),
  /** Calm: half shut, settled lower. */
  calm: both({ dy: 4, sx: 1.25, sy: 0.38 }),
  /** Sleepy: nearly shut, drooping. */
  sleepy: both({ dy: 5, sx: 1.06, sy: 0.2 }),
  /** Curious, inspecting: one eye big, the other small. */
  curious: { left: { ...OPEN, sx: 1.22, sy: 1.18 }, right: { ...OPEN, dy: 1, sx: 0.78, sy: 0.72 } },
  /** Puzzled: one eye open, the other narrowed and raised. */
  puzzled: { left: { ...OPEN, sx: 0.95, sy: 1.05 }, right: { ...OPEN, dy: -3, sx: 1.4, sy: 0.32 } },
  /** Down: low and a little smaller. */
  down: both({ dy: 5, sx: 0.92, sy: 0.7 }),
  happy: { ...both({}), happy: true },
  round: { ...both({}), round: true },
} satisfies Record<string, Face>;
export type FaceName = keyof typeof FACES;

/** The face `t` ms into a list of face keys, blended from the one before. */
export function faceAt(keys: [number, FaceName][], t: number): { face: Face; name: FaceName; from: Face; mix: number } {
  let i = -1;
  while (i + 1 < keys.length && keys[i + 1][0] <= t) i++;
  const name = i < 0 ? "open" : keys[i][1];
  const from = i < 1 ? FACES.open : FACES[keys[i - 1][1]];
  const mix = i < 0 ? 1 : EASES.both(Math.min(1, (t - keys[i][0]) / FACE_MS));
  return { face: FACES[name], name, from, mix };
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

// ---- idle moves (animations.ts): now and then while it rests ----

/** Breathing: it comes a little closer, glances one way and the other, and settles back, blinking twice. */
export const BREATHE: Moves = {
  near: [[0, 1], [900, 1], [1600, 1.07], [3000, 1.07], [3800, 1]],
  turn: [[0, 0], [900, 0], [1600, -9], [2500, 6], [3450, 0]],
  roll: [[0, 0], [900, 0], [1600, -3], [2500, 2], [3450, 0]],
  look: [[0, 0], [900, 0], [1500, -0.5], [2400, 0.45], [3400, 0]],
  blinks: [1480, 3460],
};

/** Looking around: up to one side, down to the other, up again, then all the way round to face you. */
export const LOOK_AROUND: Moves = {
  turn: [[0, 0], [500, 0], [1400, -32], [1800, -30], [2750, 14], [2930, 6], [4080, 32], [5750, 360]],
  tip: [[0, 0], [500, 0], [1400, 14], [1800, 12], [2750, -9], [2930, -16], [4080, 18], [5750, 0]],
  roll: [[0, 0], [500, 0], [1400, -10], [1800, -11], [2750, 10], [2930, 5], [4080, 14], [5750, 0]],
  shift: [[0, 0], [500, 0], [1400, -11], [1800, -11], [2750, -5], [2930, -5], [4080, 0]],
  near: [[0, 1], [2400, 1], [2800, 0.96], [3300, 1]],
  look: [[0, 0], [500, 0], [1300, -0.8], [1800, -0.8], [2700, 0.5], [3000, 0.3], [4000, 0.7], [5000, 0.6], [5600, 0]],
  lookY: [[0, 0], [500, 0], [1300, -0.6], [1800, -0.6], [2700, 0.6], [3000, 0.5], [4000, -0.4], [5600, 0]],
  blinks: [1160, 4000],
};

/** Daydreaming: calm eyes, gazing up and away, drifting from one side to the other, with slow blinks. */
export const DAYDREAM: Moves = {
  tip: [[0, 0], [600, 18], [1100, 20], [2000, 6], [2700, 6], [3900, 10], [4800, 10], [5700, 0]],
  turn: [[0, 0], [600, 16], [1100, 17], [2000, 3], [2700, 3], [3900, 32], [4800, 32], [5700, 0]],
  roll: [[0, 0], [600, 12], [1100, 14], [2000, 12], [2700, 12], [3900, 20], [4800, 20], [5700, 0]],
  look: [[0, 0], [600, 0.5], [1100, 0.5], [2000, 0.1], [2700, 0.1], [3900, 0.7], [4800, 0.7], [5600, 0]],
  lookY: [[0, 0], [600, -0.8], [1100, -0.8], [2000, -0.3], [3900, -0.5], [5600, 0]],
  eyes: [[300, "calm"], [5300, "open"]],
  blinks: [600, 2070, 2370, 4250],
};

/** Dozing off: its eyes droop, its head nods down twice, then it jolts awake with a little hop. */
export const DOZE: Moves = {
  eyes: [[200, "calm"], [1400, "sleepy"], [4300, "wide"], [5400, "open"]],
  tip: [[0, 0], [1400, -6], [2600, -14, "in"], [2900, -4, "out"], [3900, -16, "in"], [4300, 4, "out"], [5000, 0]],
  roll: [[0, 0], [2600, -5], [3900, 6], [4300, 0]],
  near: [[0, 1], [2500, 0.97], [4300, 1], [4420, 1.04, "out"], [5200, 1]],
  squash: [[0, 1], [2600, 1.05], [2900, 1], [3900, 1.06], [4300, 0.9, "out"], [4600, 1.05], [4850, 0.98], [5100, 1]],
  hop: [[0, 0], [4280, 0], [4450, 6, "out"], [4650, 0, "in"]],
  blinks: [5650],
};

/** Humming to itself: calm eyes, chin up, rocking to a beat with a little dip on each one. */
export const HUM: Moves = (() => {
  const BEAT = 500;
  const m: Required<Pick<Moves, "roll" | "turn" | "squash" | "tip" | "eyes" | "blinks">> = { roll: [[0, 0]], turn: [[0, 0]], squash: [[0, 1]], tip: [[0, 0], [500, 6], [3300, 6], [3800, 0]], eyes: [[150, "calm"], [3700, "open"]], blinks: [] };
  for (let i = 0; i < 7; i++) {
    const [t, side] = [250 + i * BEAT, i % 2 ? 1 : -1];
    m.roll.push([t, side * 7]);
    m.turn.push([t, side * 6]);
    m.squash.push([t - 120, 1], [t, 1.04, "out"], [t + 150, 1]);
  }
  m.roll.push([3800, 0]);
  m.turn.push([3800, 0]);
  return m;
})();

/** A stretch, like a yawn: it squashes down, stretches up tall with its eyes squeezed, then shakes out. */
export const STRETCH: Moves = {
  squash: [[0, 1], [400, 1.1, "out"], [1300, 0.84], [2100, 0.84], [2350, 1.06, "out"], [2550, 0.97], [2750, 1.02], [2950, 1]],
  tip: [[0, 0], [400, -6], [1300, 16], [2100, 16], [2400, -3], [2800, 0]],
  roll: [[0, 0], [1300, -4], [1700, 4], [2100, 0], [2300, -3], [2500, 2], [2700, 0]],
  eyes: [[350, "squint"], [2200, "open"]],
  blinks: [2650],
};

// ---- activity moves (animations.ts): while it works on a message, or as one lands ----

/** Streaming a reply: a nod down and up, then drifting to one side and the other as the words come. */
export const STREAM: Moves = {
  tip: [[0, 0], [350, -9], [580, 14], [830, -4], [1220, 0], [1620, 5], [2060, 2], [2590, 0]],
  turn: [[0, 0], [1220, 0], [1620, 15], [2060, -11], [2590, 0]],
  roll: [[0, 0], [830, 4], [1220, 0], [1620, -3], [2060, 18], [2590, 0]],
  shift: [[0, 0], [1220, 0], [1620, 10], [2060, -11], [2590, 0]],
  hop: [[0, 0], [350, 0], [590, 4, "out"], [830, 0, "in"]],
  squash: [[0, 1], [350, 1.05], [590, 0.97], [830, 1]],
  look: [[0, 0], [1220, 0], [1620, 0.6], [2060, -0.6], [2590, 0]],
  lookY: [[0, 0], [350, 0.4], [580, -0.3], [830, 0]],
};

/** Focusing: tipped down over its work with its eyes narrowed, floating side to side, then a turn all the way round. */
export const FOCUS: Moves = {
  eyes: [[90, "squint"], [2150, "open"]],
  tip: [[0, 0], [300, -18], [2000, -18], [2380, 0]],
  roll: [[0, 0], [700, -12], [1300, 12], [2000, -4], [2380, 0]],
  turn: [[0, 0], [700, 8], [1300, -2], [2380, 360]],
  shift: [[0, 0], [700, 12], [1300, -12], [2380, 0]],
  hop: [[0, 0], [700, 8], [1300, 8], [2380, 0]],
  lookY: [[0, 0], [300, 0.6], [2000, 0.6], [2380, 0]],
};

/** An idea: it ponders up and to one side, then its eyes go wide with a little hop, and it looks about, pleased. */
export const IDEA: Moves = {
  turn: [[0, 0], [620, 0], [1420, -26], [2270, -4], [2800, 1], [3270, -17], [3840, 13], [3980, 0]],
  tip: [[0, 0], [620, 0], [1420, 3], [2270, 26], [2800, 24], [3270, 18], [3840, 10], [3980, 0]],
  roll: [[0, 0], [620, 0], [1420, -3], [2270, 22], [2800, 5], [3270, -7], [3840, 17], [3980, 0]],
  shift: [[0, 0], [620, 0], [1420, -12], [2270, -12], [3160, 0]],
  hop: [[0, 0], [2270, 0], [2450, 5, "out"], [2650, 0, "in"]],
  squash: [[0, 1], [2200, 1], [2300, 1.08, "out"], [2450, 0.94], [2650, 1.04], [2850, 1]],
  look: [[0, 0], [1400, -0.6], [2270, -0.3], [3270, -0.4], [3840, 0.4], [3980, 0]],
  lookY: [[0, 0], [1400, 0], [2270, -0.8], [3270, -0.5], [3980, 0]],
  eyes: [[2240, "wide"], [3700, "open"]],
  blinks: [900, 3300],
};

/** Inspecting: one eye big, it tilts its head right over, backs off to look again from the other side, then spins round. */
export const INSPECT: Moves = {
  eyes: [[750, "curious"], [2560, "wide"], [3760, "open"]],
  roll: [[0, 0], [180, 0], [1410, -32], [2750, 22], [3300, 22], [3900, 6], [4780, 0]],
  turn: [[0, 0], [180, 0], [1410, -16], [2750, 16], [3300, 32], [3900, -270], [4780, -360]],
  tip: [[0, 0], [1410, -2], [2750, 4], [4780, 0]],
  shift: [[0, 0], [180, 0], [1410, -9], [2750, 9], [4780, 0]],
  near: [[0, 1], [180, 1], [1410, 0.74], [2250, 0.88], [2990, 1.03], [4610, 1]],
  look: [[0, 0], [1410, -0.6], [2750, 0.6], [3300, 0.5], [3900, 0]],
  blinks: [1200, 3500],
};

/** Rummaging: tipped over and rocking hard from side to side, eyes wide, as if digging through something. */
export const RUMMAGE: Moves = (() => {
  const m: Required<Pick<Moves, "roll" | "turn" | "tip" | "shift" | "squash" | "eyes" | "lookY">> = { roll: [[0, 0]], turn: [[0, 0]], tip: [[0, 0]], shift: [[0, 0]], squash: [[0, 1]], eyes: [[0, "wide"], [4700, "open"]], lookY: [[0, 0], [300, 0.5], [4600, 0.5], [5000, 0]] };
  [170, 1510, 1800, 3130, 3410, 4780].forEach((t, i) => {
    const side = i % 2 ? 1 : -1;
    m.roll.push([t, side * 33]);
    m.turn.push([t, side * 7]);
    m.tip.push([t, -16]);
    m.shift.push([t, side * 6]);
    m.squash.push([t - 60, 1], [t + 60, 1.05, "out"], [t + 220, 1]);
  });
  for (const k of [m.roll, m.turn, m.tip, m.shift]) k.push([5000, 0]);
  return m;
})();

/** Noticing: its eyes pop wide and it jiggles like jelly, with a tiny hop. */
export const NOTIFY: Moves = {
  eyes: [[80, "wide"], [1100, "open"]],
  squash: [[0, 1], [230, 1.13], [450, 0.92], [680, 1.05], [900, 0.99], [1080, 1]],
  hop: [[0, 0], [450, 0], [560, 3, "out"], [680, 0, "in"]],
};

/** Puzzled: it turns aside, shakes its head with one eye narrowed, backing off a little, and settles. */
export const PUZZLED: Moves = {
  eyes: [[470, "puzzled"], [1610, "open"]],
  turn: [[0, 0], [390, 26], [750, -14], [870, 14], [1050, -9], [1300, 14], [1760, 0]],
  tip: [[0, 0], [390, -6], [750, -4], [870, -10], [1050, -8], [1300, -10], [1760, 0]],
  roll: [[0, 0], [390, 6], [750, -8], [870, 7], [1050, -8], [1300, 7], [1760, 0]],
  shift: [[0, 0], [390, 2], [750, -10], [870, 0], [1050, -9], [1300, 0], [1760, 0]],
  near: [[0, 1], [390, 1], [1150, 0.85], [1900, 1]],
};

/** Down: sad eyes, its head sinking and backing away, then slowly back up. */
export const DROOP: Moves = {
  eyes: [[0, "down"], [2700, "open"]],
  tip: [[0, 0], [1260, -18], [2400, -18], [2900, 0]],
  roll: [[0, 0], [1260, -2], [2900, 0]],
  near: [[0, 1], [1260, 0.92], [2400, 0.92], [2900, 1]],
  squash: [[0, 1], [1260, 1.05], [2400, 1.05], [2900, 1]],
  blinks: [1700],
};

/** Hooray: happy eyes, it floats up and sways from one side to the other with its chin up, then lands with a bounce. */
export const HOORAY: Moves = {
  eyes: [[0, "happy"], [1300, "open"]],
  tip: [[0, 0], [380, 22], [940, 22], [1400, -12], [1590, 4], [1760, -7], [1960, 0]],
  turn: [[0, 0], [380, -6], [940, 14], [1400, 0]],
  roll: [[0, 0], [380, 14], [940, -13], [1400, -2], [1960, 0]],
  shift: [[0, 0], [380, -9], [940, 9], [1380, 0]],
  hop: [[0, 0], [380, 10, "out"], [940, 13], [1380, 0, "in"], [1580, 3, "out"], [1750, 0, "in"]],
  squash: [[0, 1], [150, 1.06], [380, 0.94], [940, 0.95], [1380, 1], [1420, 1.08, "out"], [1600, 0.97], [1800, 1]],
};

/** A twirl: happy eyes, chin up, two slow turns all the way round. */
export const TWIRL: Moves = {
  eyes: [[0, "happy"], [2700, "open"]],
  turn: [[0, 0], [2800, 720]],
  tip: [[0, 0], [700, 12], [2200, 12], [2800, 0]],
  roll: [[0, 0], [700, 10], [2200, 10], [2800, 0]],
  hop: [[0, 0], [250, 5, "out"], [700, 0, "in"]],
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

/**
 * Cheering, as its message lands: a jelly dance from side to side, timed like the satisfied nod. It squashes down,
 * then floats over to one side and back, four hops, each a little lower, leaning and turning the way it's going with
 * its eyes leading; each landing is a quick squash straight into the next hop, the last one back to the middle, and
 * it wobbles slowly to a stop.
 */
export const DANCE: Moves = (() => {
  const hops: [to: number, up: number, air: number][] = [[-11, 15, 440], [11, 14, 440], [-11, 12, 420], [0, 8, 360]];
  const LAND = 60; // on the ground between hops: a quick squash
  const m: Required<Pick<Moves, "hop" | "squash" | "tip" | "shift" | "turn" | "roll" | "look">> = { hop: [[0, 0], [160, 0]], squash: [[0, 1], [150, 1.1, "out"], [160, 1.08]], tip: [[0, 0], [150, -4, "out"]], shift: [[0, 0]], turn: [[0, 0]], roll: [[0, 0]], look: [[0, 0]] };
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

