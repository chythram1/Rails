// A Sprocket's motion engine (ADR 0035): pure, with no DOM and no timers of its own, so it can be replayed, slowed
// and tested. A rig holds a Sprocket's springs and what it's doing; `advance` moves it to a time and says what to
// draw and when it next needs a frame. Layers, from the bottom:
//   1. its stance (solid.ts POSES), or the pointer when it's following one, which overrides everything below;
//   2. one gesture at a time (clips.ts): a thinking move, a glance, the spin or the dance;
//   3. leaning in, on its own clock, which leads over a gesture's turn while it lasts;
//   4. the face: an expression, a blink and happy eyes, on their own clocks.
// The director picks what plays from the activity: resting glances now and then and leans in gently, thinking does
// one move after another and leans in often, writing spins once, and a finished animation (animations.ts, such as
// cheering) plays its gesture with its eyes for as long as it lasts, then the Sprocket goes back to resting.
import { POSES, type Pose, type Stance } from "./solid.ts";
import { animationFor, type Animation } from "./animations.ts";
import { BLINK_MS, EXPRESSIONS, GLANCE, LEAN_GLANCE, LEANS, OPEN, SPIN, THINKING, eyeAt, faceAt, lidAt, sample, type EyeShape, type Key, type Expression, type ExpressionName, type Gesture, type Rand, type Step } from "./clips.ts";

/** What a Sprocket is doing: resting, thinking (direct chats), writing (the spin), or one of the finished animations
 * (animations.ts): cheering, talking in a team (surveying), satisfied. */
export type Activity = "idle" | "think" | "write" | "cheer" | "talk" | "satisfied";

/** What a rig is told by its Sprocket. */
export interface Input {
  stance: Stance;
  /** Following the pointer (it turns to face it). */
  follow: boolean;
  activity: Activity;
  /** Only the face moves: blinks and happy eyes, no gestures (reduced motion, or too small to see them). */
  faceOnly: boolean;
}

/** What to draw. */
export interface Frame {
  pose: Pose;
  /** Where the eyes look, in viewBox units from where they're drawn. */
  look: [number, number];
  left: EyeShape;
  right: EyeShape;
  /** How shut the lids are (0 to 1) and how happy the eyes are (0 open, 1 the ^ ^ arcs). */
  lid: number;
  happy: number;
}

interface Spring {
  x: number;
  v: number;
}
type Channel = "yaw" | "pitch" | "roll" | "near" | "slide" | "lean" | "hop" | "squash" | "lookX" | "lookY" | "happy" | "round";
/** Round eyes: dilated circles (an open eye is 14×31; round, 24 across), each 3 units further out so they don't touch. */
const ROUND = { sx: 24 / 14, sy: 24 / 31, out: 3 };

export interface Rig {
  input: Input;
  rand: Rand;
  /** The time it was last advanced to, in ms. */
  clock: number;
  springs: Record<Channel, Spring>;
  /** Whole turns from spins. */
  spins: number;
  /** What the gesture layer has set, and the gesture playing: its steps, the next one, and when. */
  turn: number;
  tip: number;
  roll: number;
  shift: number;
  aim: [number, number] | null;
  gesture: { name: string; steps: Step[]; i: number; at: number } | null;
  /** The finished animation playing: its eyes, and when it ends (then it rests, whatever its activity). */
  anim: { eyes: Animation["eyes"]; moves?: Animation["moves"]; start: number; until: number; blinked: number } | null;
  /** Idle animations it plays now and then while resting (the lab; the app doesn't yet), the last one, and when next. */
  idles: Animation[] | null;
  lastIdle: Animation | null;
  nextIdle: number;
  /** The last thinking move, so the next is a different one. */
  last: string;
  /** When the next resting glance starts. */
  nextGlance: number;
  /** Leaning in: the steps, the next one and when; how near it is now, and its glance. */
  lean: { steps: [number, number][]; i: number; at: number } | null;
  nextLean: number;
  near: number;
  glance: number;
  /** The face: the expression playing and when it started, the blink's start, and when the next one comes. */
  expression: { keys: Expression; start: number } | null;
  blink: number | null;
  nextBlink: number;
  /** A pose held on purpose, over its stance and gestures (the lab's sliders). */
  hold: Partial<Pick<Pose, "yaw" | "pitch" | "roll" | "near">> | null;
}

const NEVER = Infinity;
const between = (r: Rand, a: number, b: number) => a + r() * (b - a);
/**
 * Idle timing, as a Grok bot's (measured live): once it has done something it idles without stopping, one clip
 * straight after another with half a second still between; before it first idles, a beat to settle.
 */
export const IDLE_FIRST = [1500, 3000] as const;
export const IDLE_GAP = [400, 700] as const;

export function createRig(input: Input, from: Pose, now: number, rand: Rand = Math.random): Rig {
  const at = (x: number): Spring => ({ x, v: 0 });
  const r: Rig = {
    input,
    rand,
    clock: now,
    springs: {
      yaw: at(from.yaw),
      pitch: at(from.pitch),
      roll: at(from.roll),
      near: at(from.near),
      slide: at(from.slide),
      lean: at(from.lean),
      hop: at(from.hop),
      squash: at(0),
      lookX: at(0),
      lookY: at(0),
      happy: at(0),
      round: at(0),
    },
    spins: 0,
    turn: 0,
    tip: 0,
    roll: 0,
    shift: 0,
    aim: null,
    gesture: null,
    anim: null,
    idles: null,
    lastIdle: null,
    nextIdle: NEVER,
    last: "",
    nextGlance: NEVER,
    lean: null,
    nextLean: NEVER,
    near: 0,
    glance: 0,
    expression: null,
    blink: null,
    nextBlink: now + between(rand, 2000, 5500),
    hold: null,
  };
  begin(r, now);
  return r;
}

/** Tell the rig what its Sprocket is doing now; a change starts the new activity's behaviour. */
export function setInput(r: Rig, input: Input, now: number) {
  const was = r.input;
  r.input = input;
  if (was.activity !== input.activity || was.stance !== input.stance || was.follow !== input.follow || was.faceOnly !== input.faceOnly) begin(r, now);
}

/** Start what the current activity does, dropping what the last one was doing. */
function begin(r: Rig, now: number) {
  const { activity, faceOnly } = r.input;
  clear(r);
  r.lastIdle = null;
  const a = animationFor(activity);
  r.anim = null;
  if (a) perform(r, a, now);
  else if (faceOnly) return;
  else if (activity === "think") {
    r.last = "";
    nextMove(r, now);
    r.nextLean = now + between(r.rand, 300, 1200);
  } else if (activity === "write") play(r, "spin", SPIN, now);
  else rest(r, now);
}

/** Play a finished animation now, whatever its activity (the lab plays any this way); then it rests. */
export function perform(r: Rig, a: Animation, now: number) {
  clear(r);
  r.anim = { eyes: a.eyes, moves: a.moves, start: now, until: now + a.ms, blinked: -1 };
  if (!r.input.faceOnly && a.gesture) play(r, a.name, a.gesture, now);
}

/** Let it play these idle animations now and then while resting (null: never). */
export function setIdles(r: Rig, idles: Animation[] | null, now: number) {
  r.idles = idles;
  r.nextIdle = NEVER;
  if (!r.anim && r.gesture === null) rest(r, now);
}

/** Drop what it was doing: back to its stance. */
function clear(r: Rig) {
  r.turn = r.tip = r.roll = r.shift = r.near = 0;
  r.aim = null;
  r.gesture = null;
  r.lean = null;
  r.spins = Math.round(r.spins); // whole turns look the same: keep the count, so it doesn't spin back
  r.nextGlance = r.nextLean = r.nextIdle = NEVER;
}

/** Rest: at its resting stance, and not following the pointer, it glances aside now and then and leans in gently. */
function rest(r: Rig, now: number) {
  if (r.input.follow) return;
  // Idle animations play in any stance (an open chat's row faces you); glances and leaning in only at rest.
  if (r.idles?.length && r.input.activity === "idle") {
    const [a, b] = r.lastIdle ? IDLE_GAP : IDLE_FIRST;
    r.nextIdle = now + between(r.rand, a, b);
    return;
  }
  if (r.input.stance !== "rest") return;
  r.nextGlance = now + between(r.rand, 1500, 6000);
  r.nextLean = now + between(r.rand, 2500, 6000);
}

/** Play a gesture now (the lab plays any by name). */
export function play(r: Rig, name: string, gesture: Gesture, now: number) {
  r.gesture = { name, steps: gesture(r.rand), i: 0, at: now };
}

/** Play an expression now. */
export function express(r: Rig, name: ExpressionName, now: number) {
  r.expression = { keys: EXPRESSIONS[name](r.rand), start: now };
}

/** Blink now. */
export function blink(r: Rig, now: number) {
  r.nextBlink = now;
}

/** Lean in now (when its activity leans in at all: thinking, or resting). */
export function leanIn(r: Rig, now: number) {
  if (r.nextLean !== NEVER) r.nextLean = now;
}

/** A squash and settle, for a change of look. */
export function pop(r: Rig) {
  r.springs.squash.v += 1.4;
}

/** The next thinking move: weighted at random, never the one just played. */
function nextMove(r: Rig, now: number) {
  const options = Object.entries(THINKING).filter(([name]) => name !== r.last);
  let n = r.rand() * options.reduce((sum, [, m]) => sum + m.weight, 0);
  const [name, move] = options.find(([, m]) => (n -= m.weight) < 0) ?? options[0];
  r.last = name;
  play(r, name, move.steps, now);
}

/** Run what's due by `now`: gesture steps, glances, lean-ins, blinks. */
function direct(r: Rig, now: number) {
  const { activity, faceOnly } = r.input;
  // An animation's own blinks, when it has them.
  const scripted = r.anim?.moves ? (r.anim.moves.blinks ?? []) : undefined;
  if (r.anim && scripted) {
    const at = now - r.anim.start;
    const due = scripted.findLastIndex((b) => b <= at);
    if (due > r.anim.blinked) {
      r.anim.blinked = due;
      r.blink = now;
    }
  }
  // Blinks, even with only the face moving; sometimes two together. Not while an animation plays its own (above), nor
  // with happy eyes: the ^ ^ are already shut.
  if (now >= r.nextBlink) {
    if (r.anim?.eyes !== "happy" && !scripted) r.blink = now;
    r.nextBlink = now + (r.rand() < 0.2 ? 420 : between(r.rand, 2000, 5500));
  }
  if (r.blink !== null && now - r.blink >= BLINK_MS) r.blink = null;
  if (r.expression && now - r.expression.start >= r.expression.keys.ms) r.expression = null;
  // A finished animation ends on time; then it rests, whatever its activity.
  if (r.anim && now >= r.anim.until) {
    r.anim = null;
    clear(r);
    if (!faceOnly) rest(r, now);
  }
  if (faceOnly) return;
  if (!r.anim && r.idles?.length && now >= r.nextIdle) {
    // Weighted, and the rarer ones never twice running.
    const options = r.idles.filter((a) => a !== r.lastIdle || (a.weight ?? 1) > 1);
    let n = r.rand() * options.reduce((sum, a) => sum + (a.weight ?? 1), 0);
    const a = options.find((o) => (n -= o.weight ?? 1) < 0) ?? options[0];
    r.lastIdle = a;
    perform(r, a, now);
  }
  if (r.gesture && now >= r.gesture.at) {
    const g = r.gesture;
    if (g.i < g.steps.length) {
      const s = g.steps[g.i++];
      if (s.turn !== undefined) r.turn = s.turn;
      if (s.tip !== undefined) r.tip = s.tip;
      if (s.roll !== undefined) r.roll = s.roll;
      if (s.shift !== undefined) r.shift = s.shift;
      if (s.aim !== undefined) r.aim = s.aim;
      if (s.hop) r.springs.hop.v += s.hop;
      if (s.squash) r.springs.squash.v += s.squash;
      if (s.spin) r.spins += s.spin;
      if (s.face) express(r, s.face, now);
      g.at = now + s.ms;
    } else {
      r.gesture = null;
      if (activity === "think") nextMove(r, now);
      else if (g.name === "glance") r.nextGlance = now + between(r.rand, 2500, 7000);
    }
  }
  if (!r.gesture && now >= r.nextGlance) {
    play(r, "glance", GLANCE, now);
    r.nextGlance = NEVER;
  }
  if (now >= r.nextLean) {
    r.lean = { steps: LEANS[Math.floor(r.rand() * LEANS.length)](r.rand), i: 0, at: now };
    r.glance = between(r.rand, LEAN_GLANCE.turn[0], LEAN_GLANCE.turn[1]);
    r.nextLean = NEVER;
  }
  if (r.lean && now >= r.lean.at) {
    const l = r.lean;
    if (l.i < l.steps.length) {
      const [near, ms] = l.steps[l.i++];
      r.near = near * (activity === "think" ? 1 : 0.6); // at rest it leans in less
      l.at = now + ms;
    } else {
      r.lean = null;
      r.nextLean = now + (activity === "think" ? between(r.rand, 1500, 3500) : between(r.rand, 5000, 11000));
    }
  }
}

/** An eye's shape, `round` of the way to a dilated circle; `side` is -1 for the left eye, 1 for the right. */
function dilate(e: EyeShape, round: number, side: number): EyeShape {
  return round ? { dx: e.dx + side * ROUND.out * round, dy: e.dy, sx: e.sx * (1 + (ROUND.sx - 1) * round), sy: e.sy * (1 + (ROUND.sy - 1) * round) } : e;
}

function spring(s: Spring, to: number, stiffness: number, damping: number, dt: number) {
  s.v += (stiffness * (to - s.x) - damping * s.v) * dt;
  s.x += s.v * dt;
  return Math.abs(s.v) > 0.01 || Math.abs(to - s.x) > 0.01;
}

/**
 * Move the rig to `now` (ms), `pointer` being where the pointer is from it (-1 to 1 each way) if it's following
 * one. Returns what to draw, whether anything is still moving, and how long until it next needs a frame if not.
 */
export function advance(r: Rig, now: number, pointer: [number, number] | null): { frame: Frame; moving: boolean; wake: number } {
  const dt = Math.min(0.032, Math.max(0, now - r.clock) / 1000);
  r.clock = now;
  direct(r, now);
  const { stance, activity, follow } = r.input;
  const base = POSES[stance];
  const s = r.springs;
  const watching = follow && pointer ? pointer : null;
  const [px, py] = watching ?? [0, 0];
  const [ax, ay] = watching ?? r.aim ?? [0, 0];
  // Leaning in, it glances to the viewer's left: the glance leads, a gesture's own turn only nudges it.
  const leaning = !watching && r.near > 0;
  const [k, d] = activity === "think" ? [95, 12] : watching ? [90, 15] : [70, 14];
  const [ek, ed] = watching ? [260, 26] : [620, 40];
  let moving = false;
  const go = (c: Channel, to: number, stiffness: number, damping: number) => (moving = spring(s[c], to, stiffness, damping, dt) || moving);
  const h = r.hold ?? {};
  go("yaw", h.yaw ?? (watching ? px * 36 : base.yaw + (leaning ? r.glance + r.turn * 0.2 : r.turn)) + r.spins * 360, k, d);
  go("pitch", h.pitch ?? (watching ? -py * 24 : base.pitch + r.tip), k, d);
  go("roll", h.roll ?? (watching ? px * 7 : r.roll), 140, 11);
  go("near", h.near ?? 1 + r.near, 45, 11); // slow: it eases toward the screen
  // Aside: slowly with a lean-in's glance, quicker when a gesture moves it (a dance's bounces).
  if (leaning) go("slide", LEAN_GLANCE.slide, 60, 13);
  else go("slide", r.shift, 150, 15);
  go("lean", base.lean, 110, 12);
  go("hop", 0, 300, 18);
  go("squash", 0, 400, 16);
  go("lookX", leaning ? LEAN_GLANCE.aim : ax, ek, ed);
  go("lookY", ay, ek, ed);
  // A held face from its moves (blended in), or the eyes it holds the whole time.
  const faces = r.anim?.moves?.eyes;
  const held = faces ? faceAt(faces, now - r.anim!.start) : null;
  const eyes = held ? (held.face.happy ? "happy" : held.face.round ? "round" : null) : r.anim?.eyes;
  go("happy", eyes === "happy" ? 1 : 0, 300, 30);
  go("round", eyes === "round" ? 1 : 0, 900, 24); // sudden: it pops in, overshooting a little
  const t = now;
  const e = r.expression;
  // An animation's keyframed moves, on its own clock, on top.
  const m = r.input.faceOnly ? undefined : r.anim?.moves;
  const at = r.anim ? now - r.anim.start : 0;
  const track = (keys: Key[] | undefined, rest: number) => (keys ? sample(keys, at) : rest);
  const [mh, ms, mt, mshift, mturn, mroll, mnear, mlook, mlookY] = [track(m?.hop, 0), track(m?.squash, 1), track(m?.tip, 0), track(m?.shift, 0), track(m?.turn, 0), track(m?.roll, 0), track(m?.near, 1), track(m?.look, 0), track(m?.lookY, 0)];
  if (m || held) moving = true;
  const heldEye = (side: "left" | "right", base: EyeShape): EyeShape => {
    if (!held) return base;
    const [a, b] = [held.from[side], held.face[side]];
    const mix = (x: number, y: number) => x + (y - x) * held.mix;
    const h = { dx: mix(a.dx, b.dx), dy: mix(a.dy, b.dy), sx: mix(a.sx, b.sx), sy: mix(a.sy, b.sy) };
    return { dx: base.dx + h.dx, dy: base.dy + h.dy, sx: base.sx * h.sx, sy: base.sy * h.sy };
  };
  const frame: Frame = {
    pose: { yaw: s.yaw.x + mturn, pitch: s.pitch.x + mt, roll: s.roll.x + mroll, near: s.near.x * mnear, slide: s.slide.x + mshift, lean: s.lean.x, sx: (1 + s.squash.x) * ms, sy: (1 - s.squash.x) / ms, hop: Math.max(0, s.hop.x) + mh },
    look: [(s.lookX.x + mlook) * 9, (s.lookY.x + mlookY) * 6],
    left: dilate(heldEye("left", e ? eyeAt(e.keys.left, t - e.start, e.keys.ms) : OPEN), s.round.x, -1),
    right: dilate(heldEye("right", e ? eyeAt(e.keys.right, t - e.start, e.keys.ms) : OPEN), s.round.x, 1),
    lid: r.blink === null ? 0 : lidAt(t - r.blink),
    happy: Math.min(1, Math.max(0, s.happy.x)),
  };
  if (e || r.blink !== null) moving = true;
  const due = [r.nextBlink, r.nextGlance, r.nextLean, r.nextIdle, r.gesture?.at ?? NEVER, r.lean?.at ?? NEVER, r.anim?.until ?? NEVER];
  return { frame, moving, wake: Math.max(0, Math.min(...due) - now) };
}
