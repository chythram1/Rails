// Sprocket motion (see ref characters.md §5). Idle loops are CSS (styles.css, "Sprockets"); this module
// holds the shared timing tokens, whether motion is on, and the few things JS animates: blinks,
// one-shot reactions (a squash, a spin before it writes, the eyes changing shape), and where the eyes
// look (the pointer, darting around in bursts, up while thinking).
import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/** Playful identity: arrivals overshoot ~10%; three durations. */
export const EASE_BACK = "cubic-bezier(0.34, 1.56, 0.64, 1)";
export const DURATION = { quick: 150, standard: 250, slow: 400 };

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

/**
 * About to write: crouch, hop and spin round (its drawing squeezed to its edge and through its mirror image, which
 * reads as turning on a flat drawing), with a white streak going round it twice, and land with a squash.
 */
export function twirl(svg: SVGSVGElement | null) {
  if (!svg) return;
  const hop = (scale: boolean) =>
    [
      { transform: `translateY(0)${scale ? " scale(1, 1)" : ""}` },
      { transform: `translateY(0)${scale ? " scale(1.1, 0.88)" : ""}`, offset: 0.14, easing: "ease-out" },
      { transform: `translateY(-16px)${scale ? " scale(0.12, 1.05)" : ""}`, offset: 0.36 },
      { transform: `translateY(-20px)${scale ? " scale(-1, 1)" : ""}`, offset: 0.54 },
      { transform: `translateY(-8px)${scale ? " scale(0.12, 1.02)" : ""}`, offset: 0.74, easing: "ease-in" },
      { transform: `translateY(0)${scale ? " scale(1.08, 0.92)" : ""}`, offset: 0.88, easing: "ease-out" },
      { transform: `translateY(0)${scale ? " scale(1, 1)" : ""}` },
    ];
  svg.querySelector(".s-pop")?.animate(hop(true), { duration: SPIN_MS, easing: "linear" });
  // The streak: a short dash running along the back half of a ring round its middle, then the front half, twice,
  // fading on the second lap. Its groups hop with the body.
  svg.querySelectorAll(".s-fx").forEach((fx) => fx.animate(hop(false), { duration: SPIN_MS, easing: "linear" }));
  const lap = (arcs: NodeListOf<Element>, start: number, fade: number) =>
    // The thin ring trails the main one by a few hundredths.
    arcs.forEach((arc, i) => arc.animate(
      [
        { strokeDashoffset: 34, opacity: fade },
        { strokeDashoffset: -100, opacity: fade },
      ],
      // No fill: between laps the CSS keeps it hidden (a later lap filling backwards would hide an earlier one).
      { duration: SPIN_MS * 0.17, delay: SPIN_MS * (start + i * 0.06), easing: "linear" },
    ));
  const back = svg.querySelectorAll(".s-fx-back .s-streak-arc");
  const front = svg.querySelectorAll(".s-fx-front .s-streak-arc");
  lap(back, 0.2, 1);
  lap(front, 0.36, 1);
  lap(back, 0.52, 0.6);
  lap(front, 0.68, 0.35);
}

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
export type Expression = keyof typeof EXPRESSIONS;

/** Change the eyes for a moment: `kind`, or one picked at random. */
export function express(svg: SVGSVGElement | null, kind?: Expression) {
  const eyes = svg?.querySelectorAll(".s-eye");
  if (!eyes || eyes.length < 2) return;
  const names = Object.keys(EXPRESSIONS);
  const [l, r, duration] = EXPRESSIONS[kind ?? names[Math.floor(Math.random() * names.length)]]();
  eyes[0].animate(l, { duration, easing: "ease-out" });
  eyes[1].animate(r, { duration, easing: "ease-out" });
}

/** Grow in from nothing, for a newly added accessory. */
export function popIn(el: Element | null) {
  el?.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: DURATION.standard, easing: EASE_BACK });
}

// ---- where the eyes look ----
// One requestAnimationFrame loop for every looking Sprocket. Each has two damped springs: fast eyes
// and a slower face, so the eyes lead and the face follows. They aim at the pointer (the creator's
// preview), else at `aim` (a glance, or up while thinking), else straight ahead. The loop stops once
// every spring has settled and starts again when the pointer moves or an aim changes.

interface Spring {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Looker {
  el: SVGSVGElement;
  eyes: Spring;
  face: Spring;
  written: string;
  follow: boolean;
  /** Where it's looking on its own, -1 to 1 on each axis. */
  aim: [number, number] | null;
}

const lookers = new Set<Looker>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let lastTime = 0;

const following = () => [...lookers].some((l) => l.follow);
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

/** Where a Sprocket should look, from -1 to 1 on each axis; farther pointers saturate. */
function target(l: Looker): [number, number] {
  if (!l.follow || !pointer) return l.aim ?? [0, 0];
  const r = l.el.getBoundingClientRect();
  const dx = pointer.x - (r.left + r.width / 2);
  const dy = pointer.y - (r.top + r.height * 0.65);
  const d = Math.hypot(dx, dy);
  if (d < 1) return [0, 0];
  const k = d / (d + 160) / d;
  return [dx * k, dy * k];
}

function spring(s: Spring, tx: number, ty: number, stiffness: number, damping: number, dt: number) {
  s.vx += (stiffness * (tx - s.x) - damping * s.vx) * dt;
  s.vy += (stiffness * (ty - s.y) - damping * s.vy) * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  return Math.abs(s.vx) + Math.abs(s.vy) > 0.002 || Math.abs(tx - s.x) + Math.abs(ty - s.y) > 0.002;
}

function step(now: number) {
  const dt = Math.min(0.032, (now - lastTime) / 1000);
  lastTime = now;
  let moving = false;
  for (const l of lookers) {
    const [tx, ty] = target(l);
    // Smooth after the pointer; snappy on its own, so its looks around read as darts.
    const [k, d] = l.follow && pointer ? [260, 26] : [620, 40];
    moving = spring(l.eyes, tx, ty, k, d, dt) || moving;
    moving = spring(l.face, tx, ty, 90, 17, dt) || moving;
    write(l, l.eyes.x * 10, l.eyes.y * 7, l.face.x * 5, l.face.y * 4);
  }
  frame = moving ? requestAnimationFrame(step) : 0;
}

/** Offsets in viewBox units, written as CSS variables only when they change. */
function write(l: Looker, ex: number, ey: number, fx: number, fy: number) {
  const v = [ex, ey, fx, fy].map((n) => n.toFixed(2));
  const key = v.join();
  if (key === l.written) return;
  l.written = key;
  const s = l.el.style;
  s.setProperty("--ex", v[0]);
  s.setProperty("--ey", v[1]);
  s.setProperty("--fx", v[2]);
  s.setProperty("--fy", v[3]);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Somewhere to look: anywhere round it, mostly well off centre. */
const anywhere = (): [number, number] => {
  const a = Math.random() * Math.PI * 2;
  const r = rand(0.45, 1);
  return [Math.cos(a) * r, Math.sin(a) * r * 0.85];
};

/**
 * Where a Sprocket's eyes (and, a little, its face) look while `enabled`: at the pointer with `follow`; up and
 * around, darting, while `busy` (thinking); otherwise in bursts, as if excited: two to six quick looks all over,
 * a fraction of a second each, then a rest of a second or few. Now and then the eyes change shape (`express`).
 */
export function useLook(svg: RefObject<SVGSVGElement | null>, enabled: boolean, { follow = false, busy = false } = {}) {
  const looker = useRef<Looker | null>(null);
  const thinking = useRef(busy);
  thinking.current = busy;
  useEffect(() => {
    const el = svg.current;
    if (!enabled || !el) return;
    const l: Looker = { el, eyes: { x: 0, y: 0, vx: 0, vy: 0 }, face: { x: 0, y: 0, vx: 0, vy: 0 }, written: "", follow, aim: null };
    looker.current = l;
    if (lookers.size === 0) {
      addEventListener("pointermove", onMove);
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    lookers.add(l);
    kick();
    let timer: ReturnType<typeof setTimeout>;
    const aim = (to: [number, number] | null) => ((l.aim = to), kick());
    const later = (ms: number, then: () => void) => (timer = setTimeout(then, ms));
    const rest = () => later(rand(1200, 4500), burst);
    const burst = () => {
      // Not while thinking (that has its own look), nor while it watches the pointer, nor unseen.
      if (thinking.current || (l.follow && pointer) || document.visibilityState !== "visible") return rest();
      let looks = 2 + Math.floor(Math.random() * 5);
      const next = () => {
        if (thinking.current) return rest();
        if (looks-- <= 0) {
          aim(Math.random() < 0.6 ? null : anywhere());
          if (Math.random() < 0.25) express(el);
          return rest();
        }
        aim(anywhere());
        if (Math.random() < 0.15) express(el);
        later(rand(140, 480), next);
      };
      next();
    };
    later(rand(500, 3000), burst);
    return () => {
      clearTimeout(timer);
      looker.current = null;
      lookers.delete(l);
      write(l, 0, 0, 0, 0); // back to rest
      if (lookers.size === 0) {
        removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }, [svg, enabled, follow]);

  // Thinking: darting about up high, now and then scrunching its eyes.
  useEffect(() => {
    const l = looker.current;
    if (!l) return;
    if (!busy) {
      l.aim = null;
      kick();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const ponder = () => {
      l.aim = [rand(-0.85, 0.85), rand(-1, -0.4)];
      kick();
      if (Math.random() < 0.15) express(l.el, Math.random() < 0.6 ? "squeeze" : "curious");
      timer = setTimeout(ponder, rand(250, 900));
    };
    ponder();
    return () => clearTimeout(timer);
  }, [busy, enabled]);
}
