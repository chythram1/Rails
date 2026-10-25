// Sprocket motion (see ref characters.md §5, and solid.ts for how it stands). This module holds the shared timing
// tokens, whether motion is on, and what JS animates: blinks, the eyes changing shape for a moment, and its pose (it
// turns, leans, hops and squashes) with where its eyes look: calm at rest with a glance now and then, toward the
// pointer in the creator, erratic while thinking, and a spin round as it starts writing.
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
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

/** Blink now and then (2–5.5s apart, sometimes twice). Runs with motion off too: it's tiny and rare. */
export function useBlink(lid: RefObject<SVGGElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const blink = () => lid.current?.animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0.1)" }, { transform: "scaleY(1)" }], { duration: 160, easing: "ease-in-out" });
    const next = () => {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") {
          blink();
          if (Math.random() < 0.2) setTimeout(blink, 240);
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
// One requestAnimationFrame loop for every moving Sprocket. Each has damped springs: its turn, lean, hop and squash
// (painted through solid.ts), and its eyes (written as --ex/--ey). They aim at its stance (rest, facing you, toward a
// message) plus what it's doing on its own: a glance, the pointer, or the jumps of thinking. The loop stops once
// every spring has settled and starts again when an aim changes.

interface Spring {
  x: number;
  v: number;
}
interface Poser {
  el: SVGSVGElement;
  paint: (p: Pose) => void;
  yaw: Spring;
  lean: Spring;
  hop: Spring;
  squash: Spring;
  eyesX: Spring;
  eyesY: Spring;
  written: string;
  stance: Stance;
  follow: boolean;
  busy: boolean;
  /** Turn added on its own (a glance, a jump while thinking), and whole turns from spins. */
  turn: number;
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
    // Thinking turns snap and overshoot; otherwise it turns calmly.
    const [k, d] = l.busy ? [210, 15] : watching ? [90, 16] : [70, 14];
    moving = spring(l.yaw, base.yaw + l.turn + l.spins * 360 + px * 34, k, d, dt) || moving;
    moving = spring(l.lean, base.lean, 120, 16, dt) || moving;
    moving = spring(l.hop, 0, 300, 18, dt) || moving;
    moving = spring(l.squash, 0, 400, 16, dt) || moving;
    moving = spring(l.eyesX, ax, watching ? 260 : 620, watching ? 26 : 40, dt) || moving;
    moving = spring(l.eyesY, ay, watching ? 260 : 620, watching ? 26 : 40, dt) || moving;
    const q = l.squash.x;
    l.paint({ yaw: l.yaw.x, lean: l.lean.x, sx: 1 + q, sy: 1 - q, hop: Math.max(0, l.hop.x) });
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
  /** Turn toward the pointer, eyes following it (the creator's preview). */
  follow?: boolean;
  /** Thinking: erratic. */
  busy?: boolean;
  /** Spin round once when this turns true. */
  spin?: boolean;
  /** The pose it starts from (it turns from there to its stance). */
  from: Pose;
}

/**
 * Move a Sprocket while `enabled`: `paint` draws a pose. At rest it's calm: still, glancing aside now and then, its
 * eyes sometimes changing shape. Facing you or turned toward a message it holds still. Thinking (`busy`) it's
 * erratic: quick turns either way, now and then a whole spin, a hop or a squash, its eyes darting up and around.
 */
export function usePose(svg: RefObject<SVGSVGElement | null>, paint: RefObject<(p: Pose) => void>, enabled: boolean, { stance, follow = false, busy = false, spin = false, from }: PoseOptions) {
  const poser = useRef<Poser | null>(null);
  useEffect(() => {
    const el = svg.current;
    if (!enabled || !el) return;
    const at = (x: number): Spring => ({ x, v: 0 });
    const l: Poser = {
      el,
      paint: (p) => paint.current(p),
      yaw: at(from.yaw),
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
    if (busy) {
      // Thinking: a new turn every fraction of a second, eyes up and around; sometimes a spin, a hop or a squash.
      const jump = () => {
        l.turn = rand(-70, 70);
        l.aim = [rand(-0.9, 0.9), rand(-1, -0.2)];
        const r = Math.random();
        if (r < 0.14) l.spins += pick([-1, 1]);
        else if (r < 0.3) l.hop.v += rand(160, 260);
        else if (r < 0.45) l.squash.v += pick([-1, 1]) * rand(2.5, 4);
        if (Math.random() < 0.12) express(l.el, pick(["squeeze", "curious", "wide"]));
        kick();
        later(rand(160, 560), jump);
      };
      jump();
    } else {
      l.turn = 0;
      l.aim = null;
      l.spins = Math.round(l.spins); // whole turns look the same; keep the count, so it doesn't spin back
      kick();
      if (stance === "rest" && !follow) {
        // At rest: a glance aside every few seconds, held a moment; now and then the eyes change shape.
        const glance = () => {
          if (document.visibilityState === "visible") {
            const side = pick([-1, 1]);
            l.turn = side * rand(10, 24);
            l.aim = [side * rand(0.4, 0.8), rand(-0.4, 0.3)];
            if (Math.random() < 0.2) express(l.el);
            kick();
            return later(rand(700, 1600), () => {
              l.turn = 0;
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
    return () => clearTimeout(timer);
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
}
