import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { SprocketLook } from "@rails/shared";
import { CHARACTERS, COLORS, type Primitive } from "./characters.ts";
import { dotsAt, toDots, type Drawing } from "./morph.ts";
import { REST_POSE, perform, pop, setIdles, setResting, type Activity, type Frame, type Rig } from "./engine.ts";
import { clock, kick, useRig, useSprocketMotion } from "./motion.ts";
import { ANIMATIONS, IDLES, type AnimationName } from "./animations.ts";
import { EYE, EYE_X, Eyes } from "./parts.tsx";
import { layerCount, layout, poseOf, type Box, type Stance } from "./solid.ts";

/** The drawn area of the shared 200×215 coordinate system (the shadow included). */
export const VIEW = { x: 14, y: 24, w: 172, h: 190 };

interface Props {
  look: SprocketLook;
  /** Width in px; the height follows the viewBox. */
  size: number;
  /** A drawing that holds still: no glances, blinks or reactions (thumbnails, pickers, lists). */
  still?: boolean;
  /** How it stands (solid.ts): at rest; facing you; or looking up toward its message. */
  stance?: Stance;
  /** Turn and tip toward the pointer, eyes following it (the creator's preview, a hovered row). */
  follow?: boolean;
  /**
   * What it's doing (engine.ts): resting; thinking (one move after another); starting to write (a spin); or cheering
   * as its message lands (happy eyes and a dance, `useCheering`; it starts from rest and turns to `stance`).
   */
  activity?: Activity;
  /** The drawing midway between two Sprockets (TeamThinking's morph), instead of `look`'s. */
  drawing?: Drawing;
  /** Accessible name. Without one the drawing is decorative and hidden from screen readers. */
  label?: string;
  /** Hands over its rig while it moves (the lab plays clips on it). */
  onRig?: (rig: Rig | null) => void;
  /** Its SVG's id, so another place can show the same drawing (`<use href>`), moving exactly as it does. */
  id?: string;
  /** Thinking in a direct chat: it becomes three bouncing dots, an ellipsis, and back when this turns off. */
  dots?: boolean;
  /** An animation (animations.ts) to play once each time `key` changes; then it rests. */
  play?: { name: AnimationName; key: string };
  /** Play idle animations now and then while it rests (engine.ts setIdles). */
  idles?: boolean;
  /** With nothing going on: once what's playing is over, it holds the pose it has beside its messages, still
   * (engine.ts setResting). */
  resting?: boolean;
}

/** A body's bounds before it's measured (most bodies sit about here). */
const BOX: Box = { x: 40, y: 80, width: 120, height: 116 };

/**
 * A Sprocket character, as a solid (solid.ts): the body's layers back to front, all in its colour (depth shows in
 * the outline and where the eyes sit, never as shading), each stroked to join its neighbours when turned, and the eyes on the front face. While
 * it moves, its rig (engine.ts, run by motion.ts) paints every frame straight into the SVG.
 */
export function Sprocket({ look, size, still, stance = "rest", follow = false, activity = "idle", drawing: given, label, onRig, id, dots = false, play, idles = false, resting = false }: Props) {
  const def = CHARACTERS[look.character];
  const motion = useSprocketMotion();
  const dotted = useDots(look, dots, motion);
  const drawing = given ?? dotted;
  const color = drawing?.color ?? COLORS[look.color];
  const round = drawing ? drawing.round : (def.round ?? 0);
  const face = drawing?.face ?? def.face;
  const axis = def.shadow.x;

  const svg = useRef<SVGSVGElement>(null);
  const rigEl = useRef<SVGGElement>(null);
  const layers = useRef<(SVGGElement | null)[]>([]);
  const eyes = useRef<SVGGElement>(null);
  const look_ = useRef<SVGGElement>(null);
  const shadow = useRef<SVGEllipseElement>(null);
  const box = useRef<Box>(BOX);

  // Moving, it's drawn from where it starts and the rig paints every frame after; still, from its stance.
  const [from] = useState(() => poseOf(resting ? REST_POSE : stance));
  const solid = { depth: drawing?.depth ?? def.depth, puff: drawing?.puff ?? def.puff };
  // Strokes are drawn in screen pixels (non-scaling, as the layers are squashed when turned): viewBox units to pixels.
  const px = size / VIEW.w;
  const geometry = useRef({ axis, face, half: def.shadow.half, body: solid, eyes: drawing?.eyes ?? 1, round, px });
  geometry.current = { axis, face, half: def.shadow.half, body: solid, eyes: drawing?.eyes ?? 1, round, px };
  const shown = useRef<Frame | null>(null);
  const paint = useRef((f: Frame) => {
    shown.current = f;
    const g = geometry.current;
    const l = layout(f.pose, g.axis, g.face, box.current, g.half, g.body);
    rigEl.current?.setAttribute("transform", l.rig);
    const stroke = String(strokeOf(g.round, l.gap, g.px * f.pose.near * Math.max(f.pose.sx, f.pose.sy)));
    layers.current.forEach((el, i) => {
      if (!el) return;
      // The denser slices, turned well aside; facing you the extra ones are hidden.
      if (i >= l.layers.length) return el.setAttribute("display", "none");
      el.removeAttribute("display");
      el.setAttribute("transform", l.layers[i]);
      el.setAttribute("stroke-width", stroke);
    });
    eyes.current?.setAttribute("transform", l.eyes.transform);
    eyes.current?.setAttribute("opacity", String(l.eyes.opacity * g.eyes));
    look_.current?.setAttribute("transform", `translate(${f.look[0].toFixed(2)} ${f.look[1].toFixed(2)})`);
    shadow.current?.setAttribute("rx", String(l.shadow.rx));
    paintEyes(eyes.current, f, l.eyes.slant);
  });

  const moving = !still;
  const rig = useRig(svg, paint, moving, { stance, follow, activity, faceOnly: !motion || size < 20 }, from);
  useEffect(() => {
    onRig?.(moving ? rig.current : null);
    return () => onRig?.(null);
  }, [moving, onRig, rig]);
  // After the rig's own effects (useRig, above), so a change of activity at the same time doesn't cut these short.
  useEffect(() => {
    if (!rig.current) return;
    setIdles(rig.current, idles ? IDLES : null, clock());
    kick();
  }, [idles, moving]);
  useEffect(() => {
    if (!rig.current) return;
    setResting(rig.current, resting, clock());
    kick();
  }, [resting, moving]);
  useEffect(() => {
    if (!rig.current || !play) return;
    perform(rig.current, ANIMATIONS[play.name], clock());
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play?.key, moving]);

  // Measure the body (again when it changes), and redraw where it is.
  useLayoutEffect(() => {
    const b = layers.current[0]?.getBBox(); // its own coordinates, before its transform (every slice is the same shape)
    if (b && b.width) box.current = { x: b.x, y: b.y, width: b.width, height: b.height };
    if (shown.current) paint.current(shown.current);
  }, [look.character, drawing?.d, moving]);

  // Squash when the look changes (not on first render).
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && rig.current && motion) {
      pop(rig.current);
      kick();
    }
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.character, look.color]);

  // React draws where it starts (the rig takes over from there) or, still, its stance.
  const l = layout(moving ? from : poseOf(stance), axis, face, box.current, def.shadow.half, solid);
  // Moving, enough slices for it turned well aside (solid.ts); still, only those it draws. A morph to a thinner body
  // drops some.
  const slots = moving ? layerCount(solid, true) : l.layers.length;
  layers.current.length = slots;
  const shape = drawing ? <path d={drawing.d} /> : def.body.map((p, i) => <Shape key={i} p={p} />);
  const style = { width: size, height: (size * VIEW.h) / VIEW.w } as CSSProperties;

  return (
    <svg
      ref={svg}
      id={id}
      className={"sprocket" + (still ? " still" : "")}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <ellipse ref={shadow} className="s-shadow" cx={axis} cy={203} rx={l.shadow.rx} ry={6} />
      <g ref={rigEl} transform={l.rig}>
        {Array.from({ length: slots }, (_, i) => {
          const t = l.layers[i];
          const layer = (
            <g
              key={i}
              ref={(el) => {
                layers.current[i] = el;
              }}
              transform={t ?? l.layers[l.layers.length - 1]}
              display={t ? undefined : "none"}
              className="s-layer"
              style={{ fill: color, stroke: color }}
              strokeWidth={strokeOf(round, l.gap, px)}
              strokeLinejoin="round"
            >
              {shape}
            </g>
          );
          return layer;
        })}
        <g ref={eyes} transform={l.eyes.transform} opacity={l.eyes.opacity * (drawing?.eyes ?? 1)}>
          <g ref={look_}>
            <Eyes slant={l.eyes.slant} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/**
 * Each eye's shape for frame `f`: moved, and drawn at its size with its corners fully round, so it stays a capsule (a
 * circle when it's as wide as it's tall, a rounded line as the lid shuts, widening a touch). Happy, the open eye
 * squashes away as the arc grows in. Its slant follows the pose.
 */
function paintEyes(root: SVGGElement | null, f: Frame, slant: number) {
  if (!root) return;
  const shut = 1 - 0.92 * f.lid;
  const wide = 1 + 0.08 * f.lid;
  const n = (v: number) => v.toFixed(2);
  root.querySelectorAll<SVGGElement>(".s-eye").forEach((eye, i) => {
    const x = i === 0 ? -EYE_X : EYE_X;
    const s = i === 0 ? f.left : f.right;
    eye.setAttribute("transform", `translate(${n(s.dx)} ${n(s.dy)})`);
    eye.querySelector(".s-slant")?.setAttribute("transform", `rotate(${slant} ${x} 0)`);
    const open = eye.querySelector(".s-open");
    if (open) {
      const w = EYE.w * s.sx * wide;
      const h = EYE.h * s.sy * shut * (1 - 0.75 * f.happy);
      const y = -h / 2 - 4 * f.happy;
      for (const [k, v] of [["x", x - w / 2], ["y", y], ["width", w], ["height", h], ["rx", Math.min(w, h) / 2]] as const) open.setAttribute(k, n(v));
      open.setAttribute("opacity", Math.max(0, 1 - f.happy * 1.6).toFixed(3));
    }
    const arc = eye.querySelector(".s-happy");
    arc?.setAttribute("opacity", Math.min(1, Math.max(0, f.happy * 1.6 - 0.6)).toFixed(3));
    arc?.setAttribute("transform", `translate(${x} 0) scale(${(s.sx * wide).toFixed(3)} ${(s.sy * shut * (0.5 + 0.5 * f.happy)).toFixed(3)}) translate(${-x} 0)`);
  });
}

/** A layer's stroke in screen pixels: its rounding (lune's horns) and what joins it to the next layer, at `px` a unit. */
const strokeOf = (round: number, gap: number, px: number) => +((round + gap) * px).toFixed(2);

function Shape({ p }: { p: Primitive }) {
  if ("d" in p) return <path d={p.d} />;
  return <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} transform={p.rot ? `rotate(${p.rot} ${p.cx} ${p.cy})` : undefined} />;
}

/** How long it takes to become the dots, and to come back (ms). */
const DOTS_MS = 380;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The drawing while it is, or is turning into or back from, three dots (morph.ts); undefined as itself. With
 * reduced motion it is the dots at once, still. */
function useDots(look: SprocketLook, on: boolean, motion: boolean): Drawing | undefined {
  const [frame, setFrame] = useState<Drawing | undefined>(undefined);
  const amount = useRef(0);
  useEffect(() => {
    if (!motion) {
      amount.current = on ? 1 : 0;
      setFrame(on ? toDots(look)(1) : undefined);
      return;
    }
    if (!on && amount.current === 0) return;
    const step = toDots(look);
    let raf = 0;
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      amount.current = Math.min(1, Math.max(0, amount.current + ((on ? 1 : -1) * (now - last)) / DOTS_MS));
      last = now;
      const a = amount.current;
      if (!on && a === 0) return setFrame(undefined);
      setFrame(a < 1 ? step(easeInOut(a)) : dotsAt(look, now - start));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, motion, look.character, look.color]);
  return frame;
}

