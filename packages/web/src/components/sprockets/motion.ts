// Sprocket motion in the page (ADR 0035): whether motion is on, when a Sprocket cheers, and the one loop that runs
// every moving Sprocket's rig (engine.ts). The loop draws a frame while anything moves, then sleeps until the next
// thing a rig has planned (a blink, a glance, a lean-in). Its clock can be slowed, paused and stepped (the lab).
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { advance, createRig, setInput, type Frame, type Input, type Rig } from "./engine.ts";
import type { Pose } from "./solid.ts";

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

/**
 * True for `ms` from each time `key` changes (not for the key it starts with): while an animation plays for it, such
 * as a done one for a Sprocket's newest message. The timer isn't cleared on cleanup, so StrictMode's second effect
 * run can't end it.
 */
export function usePlaying(key: string | undefined, ms: number): boolean {
  const seen = useRef(key);
  const count = useRef(0);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === undefined || key === seen.current) return;
    seen.current = key;
    const n = ++count.current;
    setOn(true);
    setTimeout(() => n === count.current && setOn(false), ms);
  }, [key]);
  return on;
}

// ---- the clock: real time, unless the lab slows, pauses or steps it ----
let speed = 1;
let virtual = 0;
let lastReal = 0;

/** Now, on the motion clock (ms). */
export function clock(): number {
  const real = performance.now();
  if (lastReal) virtual += (real - lastReal) * speed;
  lastReal = real;
  return virtual;
}

/** How fast motion runs (1 is real time, 0 paused). For the lab. */
export function setSpeed(s: number) {
  clock();
  speed = s;
  kick();
}

/** Move the clock on by `ms` and draw (stepping while paused). For the lab. */
export function stepClock(ms: number) {
  clock();
  virtual += ms;
  kick();
}

// ---- the loop ----
interface Live {
  rig: Rig;
  el: SVGSVGElement;
  paint: (f: Frame) => void;
}
const lives = new Set<Live>();
let frame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let pointer: { x: number; y: number } | null = null;

/** Draw a frame soon. */
export function kick() {
  if (frame) return;
  clearTimeout(timer);
  frame = requestAnimationFrame(tick);
}

function tick() {
  frame = 0;
  const now = clock();
  let moving = false;
  let wake = Infinity;
  for (const l of lives) {
    const out = advance(l.rig, now, l.rig.input.follow && pointer ? toPointer(l.el) : null);
    l.paint(out.frame);
    if (out.moving) moving = true;
    else wake = Math.min(wake, out.wake);
  }
  if (moving) frame = requestAnimationFrame(tick);
  else if (wake < Infinity && speed > 0) timer = setTimeout(kick, wake / speed);
}

/** The pointer from a Sprocket, -1 to 1 on each axis; farther pointers saturate. */
function toPointer(el: Element): [number, number] {
  const r = el.getBoundingClientRect();
  const dx = pointer!.x - (r.left + r.width / 2);
  const dy = pointer!.y - (r.top + r.height * 0.65);
  const d = Math.hypot(dx, dy);
  if (d < 1) return [0, 0];
  const k = d / (d + 160) / d;
  return [dx * k, dy * k];
}

const following = () => [...lives].some((l) => l.rig.input.follow);
const onMove = (e: PointerEvent) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (following()) kick();
};
const onLeave = () => {
  pointer = null;
  if (following()) kick();
};

/**
 * Run a Sprocket's rig while `enabled`: `paint` draws each frame. It starts from `from` (only when it's created) and
 * follows `input` as it changes. Returns the rig, for a squash on a change of look and for the lab.
 */
export function useRig(svg: RefObject<SVGSVGElement | null>, paint: RefObject<(f: Frame) => void>, enabled: boolean, input: Input, from: Pose): RefObject<Rig | null> {
  const rig = useRef<Rig | null>(null);
  useEffect(() => {
    const el = svg.current;
    if (!enabled || !el) return;
    const l: Live = { rig: createRig(input, from, clock()), el, paint: (f) => paint.current(f) };
    rig.current = l.rig;
    if (lives.size === 0) {
      addEventListener("pointermove", onMove);
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    lives.add(l);
    kick();
    return () => {
      rig.current = null;
      lives.delete(l);
      if (lives.size === 0) {
        removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
      }
    };
    // `input` follows below; `from` is only where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, enabled]);

  useEffect(() => {
    if (!rig.current) return;
    setInput(rig.current, input, clock());
    kick();
  }, [input.stance, input.follow, input.activity, input.faceOnly, enabled]);
  return rig;
}
