// What a Sprocket's reply in flight is doing now, from the socket (sprockets.typing, sprockets.activity), so its row
// in the list and the icon by the reply (one drawing in a direct chat, ADR 0035) show the same thing: thinking (it
// becomes three dots), a tool step (it inspects or rummages), or typing (it streams).
import { useSyncExternalStore } from "react";
import { socket } from "../../ws.ts";
import type { AnimationName } from "./animations.ts";

interface Phase {
  /** Typing a message now, and how many times it has started to (a key for each). */
  typing: boolean;
  typed: number;
  /** The tool step it's on ("Reading src/db.ts"), and how many it has taken (a key for each). */
  step: string | null;
  steps: number;
}
const NONE: Phase = { typing: false, typed: 0, step: null, steps: 0 };
const phases = new Map<string, Phase>();
const listeners = new Set<() => void>();
let listening = false;

function update(id: string, change: (p: Phase) => Phase) {
  phases.set(id, change(phases.get(id) ?? NONE));
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  if (!listening) {
    listening = true;
    socket.on((m) => {
      if (m.type === "sprockets.typing") update(m.sprocketId, (p) => (!!m.text === p.typing ? p : { ...p, typing: !!m.text, typed: p.typed + (m.text ? 1 : 0) }));
      if (m.type === "sprockets.activity") update(m.sprocketId, (p) => (m.step === p.step ? p : { ...p, step: m.step, steps: p.steps + (m.step ? 1 : 0) }));
    });
  }
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The id of a Sprocket's drawing in its row in the list: a direct chat's icon by a reply in flight shows it. */
export const rowId = (sprocketId: string) => `sp-row-${sprocketId}`;

/** A step that reads or looks something up (inspecting); any other is using a tool (rummaging). */
const LOOKING = /^(reading|looking|searching|checking|finding|opening|listing|fetching)/i;

/**
 * A Sprocket's reply in flight, while `working`: whether it shows as three dots (thinking: neither typing nor on a
 * step) and the in-flight animation to play, keyed so it plays once as each step or message starts.
 */
export function useFlight(id: string, working: boolean): { dots: boolean; play?: { name: AnimationName; key: string } } {
  const p = useSyncExternalStore(subscribe, () => phases.get(id) ?? NONE);
  if (!working) return { dots: false };
  if (p.step) return { dots: false, play: { name: LOOKING.test(p.step) ? "inspect" : "rummage", key: `step:${p.steps}` } };
  if (p.typing) return { dots: false, play: { name: "stream", key: `typing:${p.typed}` } };
  return { dots: true };
}

/** The step it's on, to name beside the icon ("Reading src/db.ts"). */
export function useStep(id: string): string | null {
  return useSyncExternalStore(subscribe, () => (phases.get(id) ?? NONE).step);
}
