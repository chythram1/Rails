import { useEffect, useRef, useState } from "react";
import type { SprocketLook } from "@rails/shared";
import { morph, type Drawing } from "./morph.ts";
import { useSprocketMotion } from "./motion.ts";
import { Sprocket } from "./Sprocket.tsx";

/** How long each member's shape holds (a range, so it never settles into a beat), then how long it takes to become
 * the next one (ms). */
const HOLD_MS = [1500, 2400] as const;
const MORPH_MS = 650;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The team's thinking icon (ADR 0033): one Sprocket, thinking as a Sprocket does (one small move after
 * another), that turns from one member into the next round `looks` (those thinking since the user's message), its
 * outline and colour reforming as it moves. With reduced motion it holds the first member's shape.
 */
export function TeamThinking({ looks, size }: { looks: { id: string; look: SprocketLook }[]; size: number }) {
  const motion = useSprocketMotion();
  const [at, setAt] = useState(0);
  const [frame, setFrame] = useState<Drawing | undefined>(undefined);
  // The member shown, by id, so a list that grows or reorders doesn't make it jump.
  const shown = useRef<string | undefined>(undefined);
  const index = Math.max(0, looks.findIndex((l) => l.id === shown.current));
  const current = looks[index] ?? looks[0];
  shown.current = current?.id;
  const key = looks.map((l) => `${l.id}:${l.look.character}:${l.look.color}`).join();

  useEffect(() => {
    if (!motion || looks.length < 2) return;
    let raf = 0;
    const timer = setTimeout(
      () => {
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
            setFrame(undefined);
            setAt((n) => n + 1);
          }
        };
        raf = requestAnimationFrame(tick);
      },
      HOLD_MS[0] + Math.random() * (HOLD_MS[1] - HOLD_MS[0]),
    );
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, key, at]);

  if (!current) return null;
  return <Sprocket look={current.look} drawing={frame} size={size} activity="think" />;
}
