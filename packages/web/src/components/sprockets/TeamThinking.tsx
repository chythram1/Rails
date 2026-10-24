import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SprocketLook } from "@rails/shared";
import { morph, still, type Frame } from "./morph.ts";
import { Eyes } from "./parts.tsx";
import { VIEW } from "./Sprocket.tsx";
import { useBlink, useSprocketMotion } from "./motion.ts";

/** How long each member's shape holds, then how long it takes to become the next one (ms). */
const HOLD_MS = 1100;
const MORPH_MS = 650;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The team's thinking icon (ADR 0033): one Sprocket that turns from one member into the next, round `looks` (those
 * thinking since the user's message), like a blob reforming. It bobs and blinks as a Sprocket does. With reduced
 * motion it holds the first member's shape.
 */
export function TeamThinking({ looks, size }: { looks: { id: string; look: SprocketLook }[]; size: number }) {
  const motion = useSprocketMotion();
  const [at, setAt] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const lid = useRef<SVGGElement>(null);
  useBlink(lid, motion);
  // The member shown, by id, so a list that grows or reorders doesn't make it jump.
  const shown = useRef<string | undefined>(undefined);
  const index = Math.max(0, looks.findIndex((l) => l.id === shown.current));
  const current = looks[index] ?? looks[0];
  shown.current = current?.id;
  const key = looks.map((l) => `${l.id}:${l.look.character}:${l.look.color}`).join();

  useEffect(() => {
    if (!motion || looks.length < 2) return;
    let raf = 0;
    const timer = setTimeout(() => {
      const from = looks[index];
      const to = looks[(index + 1) % looks.length];
      const step = morph(from.look, to.look);
      const begin = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - begin) / MORPH_MS);
        setFrame(step(ease(t)));
        if (t < 1) raf = requestAnimationFrame(tick);
        else {
          shown.current = to.id;
          setFrame(null);
          setAt((n) => n + 1);
        }
      };
      raf = requestAnimationFrame(tick);
    }, HOLD_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, key, at]);

  if (!current) return null;
  const f = frame ?? still(current.look);
  const style = { width: size, height: (size * VIEW.h) / VIEW.w, "--bob": "9px", "--period": "1.4s" } as CSSProperties;
  return (
    <svg className={"sprocket sp-team-thinking" + (motion ? "" : " still")} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} style={style} aria-hidden>
      <g className="s-rig">
        <path d={f.d} fill={f.color} stroke={f.round ? f.color : undefined} strokeWidth={f.round || undefined} strokeLinejoin="round" />
        <g transform={`translate(${f.face.x} ${f.face.y})`}>
          <g className="s-lid" ref={lid}>
            <Eyes tilt={f.face.tilt} />
          </g>
        </g>
      </g>
    </svg>
  );
}
