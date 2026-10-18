import { useEffect, useReducer, useRef } from "react";

// How a Sprocket's reply appears, after claude.ai's: text is revealed at an even pace that trails what has
// arrived by about LAG_MS (claude.ai's "completion smoother" keeps ~0.3 s behind the stream) instead of in
// the bursts the server sends, and each newly revealed stretch fades in over FADE_MS (the 0.4 s ease-out of
// claude.ai's fade-in text). A reply that arrives whole is revealed the same way, only faster.

const LAG_MS = 300;
const FINISH_MS = 150;
/** Characters per millisecond: never slower than a steady trickle, never faster than a quick wipe. */
const MIN_RATE = 0.04;
const MAX_RATE = 4;
const TICK_MS = 33;
export const FADE_MS = 400;

/** How many characters show `dt` ms after `shown` did, when `target` have arrived. */
export function revealStep(shown: number, target: number, dt: number, live: boolean): number {
  const backlog = target - shown;
  if (backlog <= 0) return target;
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, backlog / (live ? LAG_MS : FINISH_MS)));
  return Math.min(target, shown + rate * dt);
}

/**
 * Reveals `text` over time while `live` (still being written) and after it. Returns how much shows and
 * where the stretches that are still fading in start. A text that doesn't continue the previous one starts
 * over. Timers, not animation frames (they pause in hidden tabs; a hidden tab just shows everything).
 */
export function useRevealedText(text: string, live: boolean): { shown: number; fresh: number[] } {
  const shown = useRef(0);
  const prev = useRef("");
  const marks = useRef<{ from: number; at: number }[]>([]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  if (!text.startsWith(prev.current.slice(0, Math.floor(shown.current)))) {
    shown.current = 0;
    marks.current = [];
  }
  prev.current = text;

  // Restarted whenever more text arrives; runs until everything shows and the last stretch has faded in.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let last = performance.now();
    const step = () => {
      const now = performance.now();
      const before = Math.floor(shown.current);
      shown.current = document.hidden ? text.length : revealStep(shown.current, text.length, now - last, live);
      last = now;
      const after = Math.floor(shown.current);
      if (after > before) marks.current.push({ from: before, at: now });
      marks.current = marks.current.filter((m) => now - m.at < FADE_MS);
      rerender();
      if (after < text.length || marks.current.length) timer = setTimeout(step, TICK_MS);
    };
    timer = setTimeout(step, TICK_MS);
    return () => clearTimeout(timer);
  }, [text, live]);

  return { shown: Math.min(Math.floor(shown.current), text.length), fresh: marks.current.map((m) => m.from) };
}

/** The revealed part of `text`: settled text, then the stretches still fading in. */
export function Revealed({ text, shown, fresh }: { text: string; shown: number; fresh: number[] }) {
  const cuts = fresh.filter((f) => f < shown);
  return (
    <>
      {text.slice(0, cuts[0] ?? shown)}
      {cuts.map((from, i) => (
        <span key={from} className="sp-fresh">
          {text.slice(from, cuts[i + 1] ?? shown)}
        </span>
      ))}
    </>
  );
}
