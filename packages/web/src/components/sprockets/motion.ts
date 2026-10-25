// Sprocket motion (see ref characters.md §5, and solid.ts for how it stands). This module holds the shared timing
// tokens, whether motion is on, and what JS animates: blinks, the eyes changing shape for a moment, and its pose (it
// turns, tips, rolls, leans, hops and squashes) with where its eyes look: calm at rest with a glance now and then,
// toward the pointer in the creator and a hovered row, busy with one small move after another while thinking, a spin
// round as it starts writing, and a little dance with happy eyes as its message arrives in a team.
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { POSES, type Pose, type Stance } from "./solid.ts";

/** Playful identity: arrivals overshoot ~10%; three durations. */
const EASE_BACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const DURATION = { quick: 150, standard: 250, slow: 400 };

// ---- motion is on unless the OS asks for reduced motion (there's no in-app switch) ----
const REDUCED = "(prefers-reduced-motion: reduce)";

export function useSprocketMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = matchMedia(REDUCED);
      mq.addEventListener("change", fn);
      return () => mq.removeEventListener("change", fn);
    },
    () => !matchMedia(REDUCED).matches,
  );
}

/** Blink now and then (2–5.5s apart, sometimes twice): the lids close quickly, rest shut a beat and open softly,
 * the eyes widening a touch as they shut. Runs with motion off too: it's tiny and rare. */
export function useBlink(lid: RefObject<SVGGElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const blink = () =>
      lid.current?.animate(
        [
          { transform: "scale(1, 1)", easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
          { transform: "scale(1.08, 0.08)", offset: 0.32 },
          { transform: "scale(1.08, 0.08)", offset: 0.45, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
          { transform: "scale(1, 1)" },
        ],
        { duration: 300 },
      );
    const next = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") {
          blink();
          if (Math.random() < 0.2) setTimeout(blink, 420);
        }
        next();
      }, 2000 + Math.random() * 3500);
    };
    next();
    return () => clearTimeout(timer);
  }, [lid, enabled]);
}

/** Squash and settle, for a change of look. */
export function squash(el: Element | null) {
  el?.animate(
    [
      { transform: "scale(1, 1)" },
      { transform: "scale(1.07, 0.93)", offset: 0.3 },
      { transform: "scale(0.97, 1.03)", offset: 0.65 },
      { transform: "scale(1, 1)" },
    ],
    { duration: DURATION.slow, easing: "ease-out" },
  );
}

/** How long a Sprocket cheers when its message lands: happy eyes (^ ^) the whole time, dancing for the first 1.5s. */
const CHEER_MS = 5000;

/**
 * True while a Sprocket cheers: for CHEER_MS from each time `key` (its newest message) changes, or from the start if
 * it starts set and `fromStart`. The timer isn't cleared on cleanup, so StrictMode's second effect run can't end it.
 */
export function useCheering(key: string | undefined, fromStart = false): boolean {
  const seen = useRef(fromStart ? undefined : key);
  const count = useRef(0);
  const [on, setOn] = useState(fromStart && key !== undefined);
  useEffect(() => {
    if (key === undefined || key === seen.current) return;
    seen.current = key;
    const n = ++count.current;
    setOn(true);
    setTimeout(() => n === count.current && setOn(false), CHEER_MS);
  }, [key]);
  return on;
}

/** How long the spin takes (SprocketChat holds the typing dots back until it's done). */
export const SPIN_MS = 700;

// ---- expressions: the eyes change size and shape for a moment ----
type Frames = Keyframe[];
const still = { transform: "translate(0, 0) scale(1, 1)" };
const held = (to: string, outEase = EASE_BACK): Frames => [still, { transform: to, offset: 0.25, easing: "linear" }, { transform: to, offset: 0.7, easing: outEase }, still];
/** Each: the left eye's frames, the right's, and how long. */
const EXPRESSIONS: Record<string, () => [Frames, Frames, number]> = {
  // Both squeeze in together and squash: a cute scrunch.
  squeeze: () => [held("translate(5px, 1px) scale(1.25, 0.5)"), held("translate(-5px, 1px) scale(1.25, 0.5)"), 900],
  // Round dots.
  dots: () => [held("scale(1, 0.42)"), held("scale(1, 0.42)"), 1000],
  // Wide open.
  wide: () => [held("scale(1.25, 1.22)"), held("scale(1.25, 1.22)"), 750],
  // A happy squint.
  happy: () => [held("translate(0, -1px) scale(1.15, 0.3)"), held("translate(0, -1px) scale(1.15, 0.3)"), 1000],
  // One eye shuts.
  wink: () => (Math.random() < 0.5 ? [held("scale(1.1, 0.12)"), [still, still], 650] : [[still, still], held("scale(1.1, 0.12)"), 650]),
  // One eye big, the other small: curious.
  curious: () => {
    const big = held("scale(1.3, 1.3)");
    const small = held("scale(0.78, 0.78)");
    return Math.random() < 0.5 ? [big, small, 1100] : [small, big, 1100];
  },
  // Stretch, squash, settle: excited.
  bounce: () => {
    const f: Frames = [still, { transform: "scale(0.85, 1.3)", offset: 0.2 }, { transform: "scale(1.2, 0.72)", offset: 0.45 }, { transform: "scale(0.96, 1.08)", offset: 0.7 }, still];
    return [f, f, 600];
  },
};
type Expression = keyof typeof EXPRESSIONS;

/** Change the eyes for a moment: `kind`, or one picked at random. */
function express(svg: SVGSVGElement | null, kind?: Expression) {
  const eyes = svg?.querySelectorAll(".s-eye");
  if (!eyes || eyes.length < 2) return;
  const names = Object.keys(EXPRESSIONS);
  const [l, r, duration] = EXPRESSIONS[kind ?? names[Math.floor(Math.random() * names.length)]]();
  eyes[0].animate(l, { duration, easing: "ease-out" });
  eyes[1].animate(r, { duration, easing: "ease-out" });
}

// ---- its pose, and where the eyes look ----
// One requestAnimationFrame loop for every moving Sprocket. Each has damped springs: its turn, tip, roll, lean, hop
// and squash (painted through solid.ts), and its eyes (written as --ex/--ey). They aim at its stance (rest, facing you,
// toward a message) plus what it's doing on its own: a glance, the pointer, or a move while thinking. The loop stops once
// every spring has settled and starts again when an aim changes.

interface Spring {
  x: number;
  v: number;
}
interface Poser {
  el: SVGSVGElement;
  paint: (p: Pose) => void;
  yaw: Spring;
  pitch: Spring;
  roll: Spring;
  near: Spring;
  slide: Spring;
  lean: Spring;
  hop: Spring;
  squash: Spring;
  eyesX: Spring;
  eyesY: Spring;
  written: string;
  stance: Stance;
  follow: boolean;
  busy: boolean;
  /** Turn, tip, roll and nearness added on its own (a glance, a move while thinking), and whole turns from spins. */
  turn: number;
  tip: number;
  tilt: number;
  closer: number;
  /** Where it glances while leaning in (degrees of turn, - to the viewer's left). */
  glance: number;
  spins: number;
  /** Where its eyes look on their own, -1 to 1 on each axis. */
  aim: [number, number] | null;
}

const posers = new Set<Poser>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let lastTime = 0;

const following = () => [...posers].some((l) => l.follow);
const onMove = (e: PointerEvent) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (following()) kick();
};
const onLeave = () => {
  pointer = null;
  if (following()) kick();
};

function kick() {
  if (frame) return;
  lastTime = performance.now();
  frame = requestAnimationFrame(step);
}

/** The pointer from a Sprocket, -1 to 1 on each axis; farther pointers saturate. */
function toPointer(l: Poser): [number, number] {
  if (!pointer) return [0, 0];
  const r = l.el.getBoundingClientRect();
  const dx = pointer.x - (r.left + r.width / 2);
  const dy = pointer.y - (r.top + r.height * 0.65);
  const d = Math.hypot(dx, dy);
  if (d < 1) return [0, 0];
  const k = d / (d + 160) / d;
  return [dx * k, dy * k];
}

function spring(s: Spring, to: number, stiffness: number, damping: number, dt: number) {
  s.v += (stiffness * (to - s.x) - damping * s.v) * dt;
  s.x += s.v * dt;
  return Math.abs(s.v) > 0.01 || Math.abs(to - s.x) > 0.01;
}

function step(now: number) {
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;
  let moving = false;
  for (const l of posers) {
    const base = POSES[l.stance];
    const watching = l.follow && pointer;
    const [px, py] = watching ? toPointer(l) : [0, 0];
    const [ax, ay] = watching ? [px, py] : (l.aim ?? [0, 0]);
    // Following the pointer it faces it, turning and tipping toward it; otherwise its stance plus its own moves.
    const [k, d] = l.busy ? [95, 12] : watching ? [90, 15] : [70, 14];
    // Leaning in, it also glances to the viewer's left: a turn, its body and its eyes moving that way a little. The
    // glance leads; a move's own turn only nudges it.
    const leaning = !watching && l.closer > 0;
    const yaw = watching ? px * 36 : base.yaw + (leaning ? l.glance + l.turn * 0.2 : l.turn);
    const pitch = watching ? -py * 24 : base.pitch + l.tip;
    const roll = watching ? px * 7 : l.tilt;
    moving = spring(l.yaw, yaw + l.spins * 360, k, d, dt) || moving;
    moving = spring(l.pitch, pitch, k, d, dt) || moving;
    moving = spring(l.roll, roll, 140, 11, dt) || moving;
    moving = spring(l.near, 1 + l.closer, 45, 11, dt) || moving; // slow: it eases toward the screen
    moving = spring(l.slide, leaning ? -6 : 0, 60, 13, dt) || moving;
    moving = spring(l.lean, base.lean, 110, 12, dt) || moving;
    moving = spring(l.hop, 0, 300, 18, dt) || moving;
    moving = spring(l.squash, 0, 400, 16, dt) || moving;
    moving = spring(l.eyesX, leaning ? -0.6 : ax, watching ? 260 : 620, watching ? 26 : 40, dt) || moving;
    moving = spring(l.eyesY, ay, watching ? 260 : 620, watching ? 26 : 40, dt) || moving;
    const q = l.squash.x;
    l.paint({ yaw: l.yaw.x, pitch: l.pitch.x, roll: l.roll.x, near: l.near.x, slide: l.slide.x, lean: l.lean.x, sx: 1 + q, sy: 1 - q, hop: Math.max(0, l.hop.x) });
    write(l, l.eyesX.x * 9, l.eyesY.x * 6);
  }
  frame = moving ? requestAnimationFrame(step) : 0;
}

/** The eyes' offset in viewBox units, written as CSS variables only when it changes. */
function write(l: Poser, ex: number, ey: number) {
  const key = `${ex.toFixed(2)},${ey.toFixed(2)}`;
  if (key === l.written) return;
  l.written = key;
  l.el.style.setProperty("--ex", ex.toFixed(2));
  l.el.style.setProperty("--ey", ey.toFixed(2));
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

interface PoseOptions {
  stance: Stance;
  /** Turn and tip toward the pointer, eyes following it (the creator's preview, a hovered row). */
  follow?: boolean;
  /** Thinking: one small move after another. */
  busy?: boolean;
  /** Spin round once when this turns true. */
  spin?: boolean;
  /** Cheering: happy eyes while true, dancing as it starts. */
  cheer?: boolean;
  /** The pose it starts from (it turns from there to its stance). */
  from: Pose;
}

/** A step of a move: how long to hold it (ms), and what it sets. */
type MoveStep = [number, (l: Poser) => void];
const set = (l: Poser, turn: number, tip: number, roll: number, aim: [number, number] | null) => {
  l.turn = turn;
  l.tip = tip;
  l.tilt = roll;
  l.aim = aim;
};

/**
 * What a thinking Sprocket does, one after another: pondering upward, looking one way then the other, peeking round,
 * nodding, tilting its head (a roll), a bounce, a scrunch (its eyes squeezing, going round or one big), and now and
 * then a spin. Each takes a second or two; `weight` is
 * how often it comes up.
 */
const MOVES: Record<string, { weight: number; steps: () => MoveStep[] }> = {
  ponder: { weight: 3, steps: () => {
    const side = pick([-1, 1]);
    return [[rand(1100, 1700), (l) => set(l, side * rand(8, 16), rand(16, 24), side * rand(6, 12), [side * 0.4, -0.9])], [rand(500, 900), (l) => set(l, side * 4, rand(6, 10), side * 3, [0, -0.5])]];
  } },
  look: { weight: 3, steps: () => {
    const side = pick([-1, 1]);
    return [[rand(700, 1000), (l) => set(l, side * rand(30, 42), rand(-2, 6), side * 5, [side * 0.8, -0.1])], [rand(700, 1000), (l) => set(l, -side * rand(30, 42), rand(-2, 6), -side * 5, [-side * 0.8, -0.1])]];
  } },
  peek: { weight: 2, steps: () => {
    const side = pick([-1, 1]);
    return [[rand(900, 1300), (l) => set(l, side * rand(50, 60), rand(-10, -4), side * 10, [side, 0.2])], [400, (l) => set(l, side * 10, 0, 0, null)]];
  } },
  nod: { weight: 2, steps: () => [
    [320, (l) => set(l, rand(-8, 8), -14, 0, [0, 0.5])],
    [320, (l) => set(l, l.turn, 8, 0, [0, -0.3])],
    [320, (l) => set(l, l.turn, -12, 0, [0, 0.4])],
    [600, (l) => set(l, l.turn, 4, 0, null)],
  ] },
  tilt: { weight: 2, steps: () => {
    const side = pick([-1, 1]);
    return [[700, (l) => set(l, side * 10, 6, side * 22, [side * 0.5, -0.5])], [700, (l) => set(l, -side * 6, 6, -side * 16, [-side * 0.4, -0.5])], [400, (l) => set(l, 0, 0, 0, null)]];
  } },
  bounce: { weight: 2, steps: () => [
    [260, (l) => ((l.squash.v -= 2.4), set(l, l.turn, 0, 0, [0, 0.2]))],
    [700, (l) => ((l.hop.v += rand(170, 220)), (l.squash.v += 3), set(l, l.turn, 10, 0, [0, -0.6]))],
    [500, (l) => set(l, l.turn, 0, 0, null)],
  ] },
  scrunch: { weight: 1.5, steps: () => [[900, (l) => (express(l.el, pick(["squeeze", "curious", "wide", "dots"])), set(l, rand(-12, 12), rand(-4, 6), pick([-1, 1]) * 4, null))], [500, (l) => set(l, l.turn, 0, 0, null)]] },
  spin: { weight: 0.6, steps: () => [[1300, (l) => ((l.spins += pick([-1, 1])), (l.hop.v += 150), set(l, 0, 6, 0, [0, -0.4]))], [400, (l) => set(l, 0, 0, 0, null)]] },
};

/**
 * Leaning in: it comes closer to the screen (`closer`, how much bigger it looks), glancing to the viewer's left as it
 * does (turning 20–30°, its body and eyes moving that way a little), and goes back, in one of a few shapes, each a list of [nearness, ms held]. It plays on its own, alongside the moves, so it's the motion seen most:
 * every 1.5–3.5s while thinking, and smaller and rarer at rest.
 */
const LEANS: (() => [number, number][])[] = [
  // In, hold, back.
  () => [[rand(0.11, 0.15), rand(900, 1500)], [0, 0]],
  // In, then a pulse or two there.
  () => [[0.14, 700], [0.08, 450], [0.14, 500], ...(Math.random() < 0.5 ? ([[0.08, 450], [0.14, 500]] as [number, number][]) : []), [0, 0]],
  // A long, slow breath in and out.
  () => [[0.1, 1400], [0.06, 600], [0.1, 900], [0, 0]],
];

/**
 * Move a Sprocket while `enabled`: `paint` draws a pose. At rest it's calm: still, glancing aside now and then, its
 * eyes sometimes changing shape. Facing you or turned toward a message it holds still; following, it faces the
 * pointer. Thinking (`busy`) it does one small move after another (`MOVES`), never the same twice running.
 */
export function usePose(svg: RefObject<SVGSVGElement | null>, paint: RefObject<(p: Pose) => void>, enabled: boolean, { stance, follow = false, busy = false, spin = false, cheer = false, from }: PoseOptions) {
  const poser = useRef<Poser | null>(null);
  useEffect(() => {
    const el = svg.current;
    if (!enabled || !el) return;
    const at = (x: number): Spring => ({ x, v: 0 });
    const l: Poser = {
      el,
      paint: (p) => paint.current(p),
      yaw: at(from.yaw),
      pitch: at(from.pitch),
      roll: at(from.roll),
      near: at(from.near),
      slide: at(from.slide),
      lean: at(from.lean),
      hop: at(from.hop),
      squash: at(0),
      eyesX: at(0),
      eyesY: at(0),
      written: "",
      stance,
      follow,
      busy,
      turn: 0,
      tip: 0,
      tilt: 0,
      closer: 0,
      glance: 0,
      spins: 0,
      aim: null,
    };
    poser.current = l;
    if (posers.size === 0) {
      addEventListener("pointermove", onMove);
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    posers.add(l);
    kick();
    return () => {
      poser.current = null;
      posers.delete(l);
      if (posers.size === 0) {
        removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    // `from` is only where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, enabled]);

  useEffect(() => {
    const l = poser.current;
    if (!l) return;
    l.stance = stance;
    l.follow = follow;
    l.busy = busy;
    kick();
    let timer: ReturnType<typeof setTimeout>;
    const later = (ms: number, then: () => void) => (timer = setTimeout(then, ms));
    // Leaning in, on its own clock: while thinking, or at rest where it moves on its own (not facing you or
    // following the pointer, which hold their pose).
    let leanTimer: ReturnType<typeof setTimeout>;
    const leaning = busy || (stance === "rest" && !follow);
    const lean = () => {
      const steps = LEANS[Math.floor(Math.random() * LEANS.length)]();
      l.glance = -rand(20, 30);
      const soft = busy ? 1 : 0.6; // at rest it leans in less
      const run = (i: number) => {
        if (i >= steps.length) return (leanTimer = setTimeout(lean, busy ? rand(1500, 3500) : rand(5000, 11000)));
        const [near, ms] = steps[i];
        if (document.visibilityState === "visible") l.closer = near * soft;
        kick();
        leanTimer = setTimeout(() => run(i + 1), ms || 900); // the last step (back) settles before the wait
      };
      run(0);
    };
    if (leaning) leanTimer = setTimeout(lean, busy ? rand(300, 1200) : rand(2500, 6000));
    if (busy) {
      // Thinking: one move after another, each a second or two, never the same one twice running.
      let last = "";
      const next = () => {
        const options = Object.entries(MOVES).filter(([name]) => name !== last);
        let r = Math.random() * options.reduce((n, [, m]) => n + m.weight, 0);
        const [name, move] = options.find(([, m]) => (r -= m.weight) < 0) ?? options[0];
        last = name;
        const steps = move.steps();
        const run = (i: number) => {
          if (i >= steps.length) return next();
          const [ms, act] = steps[i];
          act(l);
          kick();
          later(ms, () => run(i + 1));
        };
        run(0);
      };
      next();
    } else {
      l.turn = l.tip = l.tilt = l.closer = 0;
      l.aim = null;
      l.spins = Math.round(l.spins); // whole turns look the same; keep the count, so it doesn't spin back
      kick();
      if (stance === "rest" && !follow) {
        // At rest: a glance aside every few seconds, held a moment; now and then the eyes change shape.
        const glance = () => {
          if (document.visibilityState === "visible") {
            const side = pick([-1, 1]);
            l.turn = side * rand(10, 24);
            l.tip = rand(-6, 8);
            l.aim = [side * rand(0.4, 0.8), rand(-0.4, 0.3)];
            if (Math.random() < 0.2) express(l.el);
            kick();
            return later(rand(700, 1600), () => {
              l.turn = l.tip = 0;
              l.aim = null;
              kick();
              later(rand(2500, 7000), glance);
            });
          }
          later(rand(2500, 7000), glance);
        };
        later(rand(1500, 6000), glance);
      }
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(leanTimer);
      l.closer = 0;
    };
  }, [stance, follow, busy, enabled]);

  // A spin: one whole turn, with a hop.
  const spun = useRef(spin);
  useEffect(() => {
    const l = poser.current;
    const was = spun.current;
    spun.current = spin;
    if (!l || !spin || was) return;
    l.spins += 1;
    l.hop.v += 240;
    kick();
  }, [spin, enabled]);

  // Cheering: happy eyes (^ ^) while it lasts, and a dance as it starts, twisting side to side with little hops.
  useEffect(() => {
    const l = poser.current;
    if (!l || !cheer) return;
    l.el.classList.add("joy");
    const beats = [20, -20, 16, -14, 8, 0];
    const timers = beats.map((roll, i) =>
      setTimeout(() => {
        l.tilt = roll;
        if (i % 2 === 0 && roll) l.hop.v += 110;
        kick();
      }, i * 230),
    );
    return () => {
      timers.forEach(clearTimeout);
      l.el.classList.remove("joy");
    };
  }, [cheer, enabled]);
}
