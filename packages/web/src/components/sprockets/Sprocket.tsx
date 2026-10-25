import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, COLORS, type Primitive } from "./characters.ts";
import type { Frame } from "./morph.ts";
import { squash, useBlink, usePose, useSprocketMotion } from "./motion.ts";
import { Eyes } from "./parts.tsx";
import { LAYERS, layout, poseOf, type Box, type Pose, type Stance } from "./solid.ts";

/** The drawn area of the shared 200×215 coordinate system (the shadow included). */
export const VIEW = { x: 14, y: 24, w: 172, h: 190 };

interface Props {
  look: SprocketLook;
  /** Width in px; the height follows the viewBox. */
  size: number;
  /** A drawing that holds still: no glances, blinks or reactions (thumbnails, pickers, lists). */
  still?: boolean;
  /** How it stands (solid.ts): at rest, turned a little; facing you; or turned and leaning toward its message. */
  stance?: Stance;
  /** Turn toward the pointer, eyes following it (the creator's preview). */
  follow?: boolean;
  /** Working on a reply: erratic, turning and spinning. */
  busy?: boolean;
  /** Spin round, as it starts writing: plays when this turns true. */
  spin?: boolean;
  /** Start at rest and turn to `stance` (a message that just came in). */
  turnIn?: boolean;
  /** The drawing midway between two Sprockets (TeamThinking's morph), instead of `look`'s. */
  drawing?: Frame;
  /** Accessible name. Without one the drawing is decorative and hidden from screen readers. */
  label?: string;
}

/** A body's bounds before it's measured (most bodies sit about here). */
const BOX: Box = { x: 40, y: 80, width: 120, height: 116 };

/**
 * A Sprocket character, as a solid (solid.ts): the body's layers back to front (the faces in its colour, the side
 * between them darker), the side's band seen edge-on, and the eyes on the front face. s-pop squashes on a change of
 * look; s-eyes looks (motion.ts writes --ex/--ey); s-lid blinks; each s-eye changes size and shape.
 */
export function Sprocket({ look, size, still, stance = "rest", follow, busy = false, spin = false, turnIn, drawing, label }: Props) {
  const def = CHARACTERS[look.character];
  const color = drawing?.color ?? COLORS[look.color];
  const round = drawing ? drawing.round : (def.round ?? 0);
  const face = drawing?.face ?? def.face;
  const axis = def.shadow.x;
  const motion = useSprocketMotion();
  const live = !still && motion;

  const svg = useRef<SVGSVGElement>(null);
  const pop = useRef<SVGGElement>(null);
  const lid = useRef<SVGGElement>(null);
  const rig = useRef<SVGGElement>(null);
  const layers = useRef<(SVGGElement | null)[]>([]);
  const band = useRef<SVGRectElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const shadow = useRef<SVGEllipseElement>(null);
  const box = useRef<Box>(BOX);
  const mounted = useRef(false);

  // Moving, it's drawn from where it started and motion.ts paints every frame after; still, from its stance.
  const [from] = useState<Pose>(() => poseOf(turnIn ? "rest" : stance));
  const pose = live ? from : poseOf(stance);
  const shown = useRef(pose);
  const paint = useRef((p: Pose) => {
    shown.current = p;
    const g = geometry.current;
    const l = layout(p, g.axis, g.face, box.current, g.half);
    rig.current?.setAttribute("transform", l.rig);
    layers.current.forEach((el, i) => el?.setAttribute("transform", l.layers[i]));
    const b = band.current;
    if (b) for (const [k, v] of Object.entries(l.band)) b.setAttribute(k, String(v));
    eyes.current?.setAttribute("transform", l.eyes.transform);
    eyes.current?.setAttribute("opacity", String(l.eyes.opacity));
    shadow.current?.setAttribute("rx", String(l.shadow.rx));
  });
  const geometry = useRef({ axis, face, half: def.shadow.half });
  geometry.current = { axis, face, half: def.shadow.half };

  useBlink(lid, !still);
  usePose(svg, paint, live && size >= 20, { stance, follow, busy, spin, from });

  // The band is as tall as the body: measure it (again when the body changes), and redraw where it is.
  useLayoutEffect(() => {
    const b = layers.current[LAYERS - 1]?.getBBox(); // its own coordinates, before its transform
    if (b && b.width) box.current = { x: b.x, y: b.y, width: b.width, height: b.height };
    if (live) paint.current(shown.current);
  }, [look.character, drawing?.d, live]);

  // Squash when the look changes (not on first render).
  useEffect(() => {
    if (mounted.current && live) squash(pop.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.character, look.color]);
  useEffect(() => {
    mounted.current = true;
  }, []);

  const l = layout(pose, axis, face, box.current, def.shadow.half);
  const side = `color-mix(in oklab, ${color} 68%, #000)`;
  const body = drawing ? <path d={drawing.d} /> : def.body.map((p, i) => <Shape key={i} p={p} />);
  const style = { width: size, height: (size * VIEW.h) / VIEW.w } as CSSProperties;

  return (
    <svg
      ref={svg}
      className={"sprocket" + (still ? " still" : "")}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ellipse ref={shadow} className="s-shadow" cx={axis} cy={203} rx={l.shadow.rx} ry={6} />
      <g ref={rig} transform={l.rig}>
        <g className="s-pop" ref={pop}>
          {l.layers.map((t, i) => {
            const end = i === 0 || i === LAYERS - 1;
            const layer = (
              <g
                key={i}
                ref={(el) => {
                  layers.current[i] = el;
                }}
                transform={t}
                style={{ fill: end ? color : side, stroke: round ? (end ? color : side) : undefined }}
                strokeWidth={round || undefined}
                strokeLinejoin="round"
              >
                {body}
              </g>
            );
            // The side seen edge-on goes under the front face.
            return i === LAYERS - 1 ? [<rect key="band" ref={band} style={{ fill: side }} {...l.band} />, layer] : layer;
          })}
          <g ref={eyes} transform={l.eyes.transform} opacity={l.eyes.opacity}>
            <g className="s-eyes">
              <g className="s-lid" ref={lid}>
                <Eyes tilt={face.tilt} />
              </g>
            </g>
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
