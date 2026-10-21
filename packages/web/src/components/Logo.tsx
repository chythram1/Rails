import type { CSSProperties } from "react";

/**
 * The Rails logo: an armadillo made of rounded bars, facing left, its tail toward the wordmark (the drawing on its
 * own, for pages outside the app, is `assets/logo.svg`). It walks in place while the pointer is on the brand, and in
 * the collapsed sidebar it curls up into a ball: the eight bands of its shell round into a circle resting where its feet stood,
 * and the head, tail and feet tuck in under them. Every bar carries its place in the ball as `--curl` (a transform
 * worked out below); styles.css applies it in the rail and times the moves. Decorative: the wordmark or the
 * sidebar's button names it.
 *
 * The coordinates are the source drawing's, which faces left as the logo does.
 */

/** Every bar is 5 wide with round ends. */
const W = 5;
type Bar = { x: number; y: number; h: number };

/**
 * The ball, its bottom on the ground the feet stand on (y = 91). It forms where the shell stands, 2 units toward
 * the head from the shell's middle (x = 86): with the short head at the sidebar's edge, that's the icon column, so
 * the armadillo curls up in place. (Facing the other way, the long tail put the shell well right of the column,
 * and the ball had to form 20 units back.)
 */
const SHELL_MID = 86;
const BALL = { x: 84, r: 34.5, bottom: 91 };
const BEHIND = BALL.x - SHELL_MID;
const BALL_Y = BALL.bottom - Math.sqrt(BALL.r ** 2 - 4.5 ** 2);

/** A band's place in the ball: moved back with it, and as tall as the circle is there. */
function inBall(band: number): Bar {
  const x = band + BEHIND;
  const off = x + W / 2 - BALL.x;
  const h = 2 * Math.sqrt(BALL.r ** 2 - off ** 2);
  return { x, y: BALL_Y - h / 2, h };
}

/** Tucked under the band that started at `band`: no taller than it is in the ball, centred on it, so it's covered. */
const tucked = (band: number, h: number, cy = BALL_Y): Bar => ({ x: band + BEHIND, y: cy - h / 2, h });

/** The transform that takes `from` to `to` (SVG units, from the drawing's origin). */
function curl(from: Bar, to: Bar): string {
  const s = to.h / from.h;
  const n = (v: number) => Math.round(v * 100) / 100;
  return `translate(${n(to.x - from.x)}px, ${n(to.y - s * from.y)}px) scale(1, ${n(s)})`;
}

const BANDS: Bar[] = [
  { x: 52, y: 48, h: 29 },
  { x: 61, y: 40, h: 38 },
  { x: 70, y: 35, h: 43 },
  { x: 79, y: 33, h: 45 },
  { x: 88, y: 33, h: 45 },
  { x: 97, y: 36, h: 42 },
  { x: 106, y: 42, h: 36 },
  { x: 115, y: 51, h: 25 },
];
/** Nose to ear; they slide in under the first band. */
const HEAD: Bar[] = [
  { x: 19, y: 65, h: 5 },
  { x: 27, y: 61, h: 12 },
  { x: 35, y: 61, h: 14 },
  { x: 43, y: 53, h: 23 },
  { x: 43, y: 39, h: 11 },
];
/** Its wave lifts each bar a little more than the one before (`lift`, `drop`), a beat later (`lag`, seconds). */
const TAIL: (Bar & { lift: number; drop: number; lag: number })[] = [
  { x: 126, y: 65, h: 15, lift: -1.5, drop: 1, lag: 0 },
  { x: 134, y: 70, h: 13, lift: -3, drop: 1.5, lag: 0.06 },
  { x: 142, y: 74, h: 11, lift: -4, drop: 2, lag: 0.12 },
  { x: 150, y: 77, h: 9, lift: -5, drop: 2, lag: 0.18 },
  { x: 158, y: 79, h: 7, lift: -6, drop: 2.5, lag: 0.24 },
  { x: 166, y: 80, h: 5, lift: -7, drop: 2.5, lag: 0.3 },
];
/** Front pair and back pair; `a` and `b` step in turn. Each pulls up into the band above it. */
const FEET: (Bar & { step: "a" | "b"; band: number })[] = [
  { x: 59, y: 78, h: 13, step: "a", band: 61 },
  { x: 69, y: 79, h: 12, step: "b", band: 70 },
  { x: 104, y: 79, h: 12, step: "b", band: 106 },
  { x: 114, y: 78, h: 13, step: "a", band: 115 },
];
const FIRST = BANDS[0].x;
const LAST = BANDS[BANDS.length - 1].x;

type Vars = CSSProperties & Record<`--${string}`, string>;

function Part({ bar, to, kind, className, style }: { bar: Bar; to: Bar; kind: string; className?: string; style?: Vars }) {
  return (
    <g className={`lg-part ${kind}`} style={{ "--curl": curl(bar, to) } as Vars}>
      <rect className={className} x={bar.x} y={bar.y} width={W} height={bar.h} rx={W / 2} style={style} />
    </g>
  );
}

export function Logo() {
  return (
    // The drawing spans 19 (the nose) to 171 (the tip of the tail), 1 to 153 in the box; the ball's middle is at 84 - 18 = 66.
    <svg className="logo-armadillo" viewBox="18 20.8 156 72" aria-hidden focusable="false">
      <g className="lg-ink">
        {TAIL.map((t) => (
          <Part
            key={t.x}
            bar={t}
            to={tucked(LAST, Math.min(t.h, 20))}
            kind="lg-tuck"
            className="lg-motion lg-tail"
            style={{ "--lift": `${t.lift}px`, "--drop": `${t.drop}px`, "--lag": `${t.lag}s` }}
          />
        ))}
      </g>
      <g className="lg-foot">
        {FEET.map((f) => (
          <Part key={f.x} bar={f} to={tucked(f.band, 5, 75)} kind="lg-feet" className={`lg-motion lg-step-${f.step}`} />
        ))}
      </g>
      <g className="lg-ink">
        <g className="lg-motion lg-head">
          {HEAD.map((b) => (
            <Part key={`${b.x},${b.y}`} bar={b} to={tucked(FIRST, Math.min(b.h, 20))} kind="lg-tuck" />
          ))}
          <g className="lg-part lg-tuck" style={{ "--curl": `translate(${FIRST + BEHIND - 34}px, ${Math.round((BALL_Y - 56) * 100) / 100}px)` } as Vars}>
            <circle cx="36.5" cy="56" r="1.8" />
          </g>
        </g>
        {BANDS.map((b, i) => (
          <Part key={b.x} bar={b} to={inBall(b.x)} kind="lg-band" className="lg-motion lg-ripple" style={{ "--lag": `${i * 0.025}s` }} />
        ))}
      </g>
    </svg>
  );
}
