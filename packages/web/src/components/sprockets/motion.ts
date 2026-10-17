// Sprocket motion (see ref characters.md §5). Idle loops are CSS (styles.css, "Sprockets"); this module
// holds the shared timing tokens, whether motion is on, and the few things JS animates: blinks,
// one-shot reactions, and eyes that follow the pointer.
import { useEffect, useSyncExternalStore, type RefObject } from "react";

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

/** Grow in from nothing, for a newly added accessory. */
export function popIn(el: Element | null) {
  el?.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], { duration: DURATION.standard, easing: EASE_BACK });
}

// ---- eyes that follow the pointer ----
// One requestAnimationFrame loop for every following Sprocket. Each has two damped springs: fast eyes
// and a slower face, so the eyes lead and the face follows. The loop stops once every spring has
// settled and starts again when the pointer moves.

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
}

const lookers = new Set<Looker>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;
let lastTime = 0;

const onMove = (e: PointerEvent) => {
  pointer = { x: e.clientX, y: e.clientY };
  kick();
};
const onLeave = () => {
  pointer = null;
  kick();
};

function kick() {
  if (frame) return;
  lastTime = performance.now();
  frame = requestAnimationFrame(step);
}

/** Where a Sprocket should look, from -1 to 1 on each axis; farther pointers saturate. */
function target(el: SVGSVGElement): [number, number] {
  if (!pointer) return [0, 0];
  const r = el.getBoundingClientRect();
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
    const [tx, ty] = target(l.el);
    moving = spring(l.eyes, tx, ty, 260, 26, dt) || moving;
    moving = spring(l.face, tx, ty, 90, 17, dt) || moving;
    write(l, l.eyes.x * 7, l.eyes.y * 5, l.face.x * 4, l.face.y * 3);
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

/** Make a Sprocket's eyes (and, a little, its face) follow the pointer while `enabled`. */
export function useLook(svg: RefObject<SVGSVGElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = svg.current;
    if (!enabled || !el) return;
    const l: Looker = { el, eyes: { x: 0, y: 0, vx: 0, vy: 0 }, face: { x: 0, y: 0, vx: 0, vy: 0 }, written: "" };
    if (lookers.size === 0) {
      addEventListener("pointermove", onMove);
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    lookers.add(l);
    kick();
    return () => {
      lookers.delete(l);
      write(l, 0, 0, 0, 0); // back to rest
      if (lookers.size === 0) {
        removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }, [svg, enabled]);
}
