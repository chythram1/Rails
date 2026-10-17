import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, type Primitive } from "./characters.ts";
import { popIn, squash, useBlink, useLook, useSprocketMotion } from "./motion.ts";
import { Eyes, Eyewear, Hat, Headphones, Scarf } from "./parts.tsx";

/** Seconds per bob at tempo 1. Sway takes longer, so the two never line up. */
const PERIOD = 3.4;
/** The drawn area of the shared 200×215 coordinate system (hats, ear cups and the shadow included). */
const VIEW = { x: 14, y: 24, w: 172, h: 190 };

interface Props {
  look: SprocketLook;
  /** Width in px; the height follows the viewBox. */
  size: number;
  /** A static drawing: no idle motion, blinks or reactions (thumbnails, pickers). */
  still?: boolean;
  /** Eyes follow the pointer (the creator's preview). */
  follow?: boolean;
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
 * motion: s-rig bobs, s-sway sways, s-pop squashes on change, s-face/s-eyes follow the pointer, s-lid
 * blinks, and hats and dangling bits trail the bob a little later.
 */
export function Sprocket({ look, size, still, follow, label, seed = look.character }: Props) {
  const def = CHARACTERS[look.character];
  const motion = useSprocketMotion();
  const live = !still && motion;
  const svg = useRef<SVGSVGElement>(null);
  const pop = useRef<SVGGElement>(null);
  const lid = useRef<SVGGElement>(null);
  const mounted = useRef(false);

  useBlink(lid, !still);
  useLook(svg, !!follow && live);

  // Squash when the look changes (not on first render).
  useEffect(() => {
    if (mounted.current && live) squash(pop.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.character, look.head, look.eyes, look.neck]);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const period = PERIOD * def.tempo;
  const style = {
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
          <g className="s-pop" ref={pop}>
            <g fill={def.color} stroke={def.round ? def.color : undefined} strokeWidth={def.round} strokeLinejoin="round">
              {def.body.map((p, i) => (
                <Shape key={i} p={p} />
              ))}
            </g>
            {look.neck === "scarf" && (
              <g transform={`translate(${def.neck.x} ${def.neck.y})`}>{part("scarf", <Scarf half={def.neck.half} colors={def.scarf} />)}</g>
            )}
            <g transform={`translate(${def.face.x} ${def.face.y})`}>
              <g className="s-face">
                <g className="s-eyes">
                  <g className="s-lid" ref={lid}>
                    <Eyes tilt={def.face.tilt} />
                  </g>
                </g>
                {look.eyes !== "none" && part(look.eyes, <Eyewear id={look.eyes} />)}
              </g>
            </g>
            {look.head === "headphones" ? (
              <g transform={`translate(${def.ears.x} ${def.ears.y})`}>{part("headphones", <Headphones ears={def.ears} />)}</g>
            ) : (
              look.head !== "none" && (
                <g transform={`translate(${def.hat.x} ${def.hat.y}) rotate(${def.hat.rot})`}>
                  <g className="s-hat">{part(look.head, <Hat id={look.head} />)}</g>
                </g>
              )
            )}
          </g>
        </g>
      </g>
    </svg>
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
