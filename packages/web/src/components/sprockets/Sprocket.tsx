import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, COLORS, type Primitive } from "./characters.ts";
import { popIn, squash, twirl, useBlink, useLook, useSprocketMotion } from "./motion.ts";
import { Eyes, Hat } from "./parts.tsx";

/** Seconds per half bob (up, or down) at tempo 1. Sway takes longer, so the two never line up. */
const PERIOD = 1.7;

/**
 * Idle motion by drawn size: small avatars need bigger, quicker moves to read at all, big ones calmer.
 * `bob` is in viewBox units, `sway` in degrees, `speed` scales the period.
 */
function idleFor(size: number) {
  if (size <= 64) return { bob: 9, sway: 6, speed: 0.8 };
  if (size <= 110) return { bob: 7, sway: 4.5, speed: 0.9 };
  return { bob: 6, sway: 3.5, speed: 1 };
}
/** The drawn area of the shared 200×215 coordinate system (hats, ear cups and the shadow included). */
export const VIEW = { x: 14, y: 24, w: 172, h: 190 };

interface Props {
  look: SprocketLook;
  /** Width in px; the height follows the viewBox. */
  size: number;
  /** A static drawing: no idle motion, blinks or reactions (thumbnails, pickers). */
  still?: boolean;
  /** Eyes follow the pointer (the creator's preview). */
  follow?: boolean;
  /** Working on a reply: it looks up and around, thinking. */
  busy?: boolean;
  /** Spin round (with a streak), as it starts writing: plays when this turns true. */
  spin?: boolean;
  /** Accessible name. Without one the drawing is decorative and hidden from screen readers. */
  label?: string;
  /** Stable key (e.g. the Sprocket's id) that sets where in its idle loop this one starts. */
  seed?: string;
}

/** Where in the idle loop to start (0–1), derived from a stable key so copies never move in sync. */
function phaseOf(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * A Sprocket character (see ref characters.md §5.2 for the layers). Each nested group owns one kind of
 * motion: s-rig bobs, s-sway sways, s-pop squashes on change and spins (s-fx, the streak round it, behind and in
 * front), s-face/s-eyes look (at the pointer, around, up while thinking), s-lid blinks, each s-eye changes size and
 * shape, and the accessory (and its wobbly bits) trails the bob a little later.
 */
export function Sprocket({ look, size, still, follow, busy = false, spin = false, label, seed = look.character }: Props) {
  const def = CHARACTERS[look.character];
  const color = COLORS[look.color];
  const motion = useSprocketMotion();
  const live = !still && motion;
  const svg = useRef<SVGSVGElement>(null);
  const pop = useRef<SVGGElement>(null);
  const lid = useRef<SVGGElement>(null);
  const mounted = useRef(false);

  useBlink(lid, !still);
  // Too small to see the eyes move (a 16px mention): they don't look around.
  useLook(svg, live && size >= 24, { follow, busy });

  useEffect(() => {
    if (spin && live) twirl(svg.current);
  }, [spin, live]);

  // Squash when the look changes (not on first render).
  useEffect(() => {
    if (mounted.current && live) squash(pop.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.character, look.color, look.accessory]);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const idle = idleFor(size);
  const period = PERIOD * def.tempo * idle.speed;
  const style = {
    "--bob": `${idle.bob}px`,
    "--sway": `${idle.sway}deg`,
    "--streak-w": `${size <= 40 ? 14 : size <= 90 ? 9 : 7}px`,
    width: size,
    height: (size * VIEW.h) / VIEW.w,
    "--period": `${period.toFixed(2)}s`,
    "--phase": `${(-phaseOf(seed) * period).toFixed(2)}s`,
  } as CSSProperties;

  const part = (key: string, children: ReactNode) => (
    <PopIn key={key} animate={live} mounted={mounted}>
      {children}
    </PopIn>
  );

  return (
    <svg
      ref={svg}
      className={"sprocket" + (still ? " still" : live ? "" : " paused")}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ellipse className="s-shadow" cx={def.shadow.x} cy={203} rx={def.shadow.half} ry={6} />
      <g className="s-rig">
        <g className="s-sway">
          {live && <Streak def={def} half="back" />}
          <g className="s-pop" ref={pop}>
            <g fill={color} stroke={def.round ? color : undefined} strokeWidth={def.round} strokeLinejoin="round">
              {def.body.map((p, i) => (
                <Shape key={i} p={p} />
              ))}
            </g>
            <g transform={`translate(${def.face.x} ${def.face.y})`}>
              <g className="s-face">
                <g className="s-eyes">
                  <g className="s-lid" ref={lid}>
                    <Eyes tilt={def.face.tilt} />
                  </g>
                </g>
              </g>
            </g>
            {look.accessory !== "none" && (
              <g transform={`translate(${def.hat.x} ${def.hat.y}) rotate(${def.hat.rot})`}>
                <g className="s-hat">{part(look.accessory, <Hat id={look.accessory} />)}</g>
              </g>
            )}
          </g>
          {live && <Streak def={def} half="front" />}
        </g>
      </g>
    </svg>
  );
}

/**
 * Half of the two rings the spin's streaks run along: one round the body's middle, a thinner one higher up. The
 * back halves are drawn behind the body, the front halves over it. Hidden until twirl() runs a dash along them
 * (pathLength 100).
 */
function Streak({ def, half }: { def: (typeof CHARACTERS)[keyof typeof CHARACTERS]; half: "back" | "front" }) {
  const arc = (cy: number, rx: number, ry: number) => {
    const cx = def.shadow.x;
    return half === "back" ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}` : `M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`;
  };
  return (
    <g className={`s-fx s-fx-${half}`}>
      <path className="s-streak-arc" d={arc(def.face.y + 8, def.shadow.half + 18, 14)} pathLength={100} />
      <path className="s-streak-arc thin" d={arc(def.face.y - 22, def.shadow.half + 6, 11)} pathLength={100} />
    </g>
  );
}

function Shape({ p }: { p: Primitive }) {
  if ("d" in p) return <path d={p.d} />;
  return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} transform={p.rot ? `rotate(${p.rot} ${p.cx} ${p.cy})` : undefined} />;
}

/** An accessory that grows in when it's put on after the Sprocket first rendered. */
function PopIn({ animate, mounted, children }: { animate: boolean; mounted: RefObject<boolean>; children: ReactNode }) {
  const g = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    if (animate && mounted.current) popIn(g.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <g className="s-in" ref={g}>
      {children}
    </g>
  );
}
