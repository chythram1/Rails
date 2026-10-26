// What a Sprocket's reply in flight is doing now, from the socket (sprockets.phase, sprockets.activity), so its row
// in the list, the icon by the reply (one drawing in a direct chat, ADR 0035) and the status line beside it show the
// same thing, in the order a Grok bot's do: it starts on it (working), thinks (it becomes three dots), takes tool
// steps (it inspects or rummages), and types (it streams).
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReplyPhase } from "@rails/shared";
import { socket } from "../../ws.ts";
import type { AnimationName } from "./animations.ts";

interface Phase {
  /** Working, thinking or typing (null before its run starts), and how many times it has changed (a key for each). */
  phase: ReplyPhase | null;
  phased: number;
  /** The tool step it's on ("Reading src/db.ts"), and how many it has taken (a key for each). */
  step: string | null;
  steps: number;
}
const NONE: Phase = { phase: null, phased: 0, step: null, steps: 0 };
const phases = new Map<string, Phase>();
const listeners = new Set<() => void>();
let listening = false;
let version = 0;

function update(id: string, change: (p: Phase) => Phase) {
  const was = phases.get(id) ?? NONE;
  const now = change(was);
  if (now === was) return;
  phases.set(id, now);
  version++;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  if (!listening) {
    listening = true;
    socket.on((m) => {
      if (m.type === "sprockets.phase") update(m.sprocketId, (p) => (m.phase === p.phase ? p : { ...p, phase: m.phase, phased: p.phased + 1 }));
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
 * A Sprocket's reply in flight, while `working`: whether it shows as three dots (thinking) and the in-flight
 * animation to play, keyed so it plays once as each phase or step starts: Focus as it starts on it, Inspect or
 * Rummage at a tool step, Stream as it types.
 */
export function useFlight(id: string, working: boolean): { dots: boolean; play?: { name: AnimationName; key: string } } {
  const p = useSyncExternalStore(subscribe, () => phases.get(id) ?? NONE);
  if (!working) return { dots: false };
  if (p.step) return { dots: false, play: { name: LOOKING.test(p.step) ? "inspect" : "rummage", key: `step:${p.steps}` } };
  if (p.phase === "thinking") return { dots: true };
  return { dots: false, play: { name: p.phase === "typing" ? "stream" : "focus", key: `phase:${p.phased}` } };
}

/** Re-renders on any Sprocket's phase or step: for reading several with `phaseOf`. */
export function useFlights(): void {
  useSyncExternalStore(subscribe, () => version);
}
export const phaseOf = (id: string): Phase => phases.get(id) ?? NONE;

// A Grok bot's words for each (its own, as it says them).
const WORKING = ["Getting it done", "Making progress", "Working on it", "Handling it", "Chipping away"];
const THINKING = ["Thinking it through", "Mulling it over", "Putting it together"];
const pick = (list: string[], draw: number) => list[Math.min(list.length - 1, Math.floor(draw * list.length))];

/** One Sprocket's status, said on its own: its tool step, a phrase for working or thinking, or "Typing…". */
function statusOf(p: Phase, draw: number): string {
  if (p.step) return p.step;
  if (p.phase === "typing") return "Typing…";
  return pick(p.phase === "thinking" ? THINKING : WORKING, draw);
}
const keyOf = (p: Phase) => (p.step ? `step:${p.steps}` : (p.phase ?? "working"));

/** "Bo", "Bo and Cy", "Bo, Cy and Di", "Bo, Cy and 2 others". */
function names(list: string[]): string {
  const shown = list.length > 3 ? [...list.slice(0, 2), `${list.length - 2} others`] : list;
  return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

const allTyping = (all: Phase[]) => all.every((p) => p.phase === "typing" && !p.step);

/** The status line's words for those on it (useStatus), `draw` picking a phrase. */
export function statusText(all: (Phase & { name: string })[], team: boolean, draw: number): string {
  if (!all.length) return "";
  if (all.length > 1) return `${names(all.map((w) => w.name))} are ${allTyping(all) ? "typing" : "working"}…`;
  const one = statusOf(all[0], draw);
  return team && !one.endsWith("…") ? `${one}…` : one;
}

/** How long each status shows at least before the next (ms): a Grok bot's 0.8 s, so quick steps don't flicker. */
const HOLD_MS = 800;

/**
 * The status line by a reply in flight, as a Grok bot's: in a direct chat what it's doing ("Making progress",
 * "Mulling it over", "Searching the web", "Typing…"), its phrase drawn afresh at each change; in a team, one member
 * on it the same with "…", several by name ("Bo and Cy are working…", "… are typing…" once all of them are).
 */
export function useStatus(on: { id: string; name: string }[], team: boolean): string {
  useFlights();
  const all = on.map((w) => ({ name: w.name, ...phaseOf(w.id) }));
  const key = on.length > 1 ? `${on.map((w) => w.id).join()}:${allTyping(all)}` : all[0] ? keyOf(all[0]) : "";
  const make = (draw: number) => statusText(all, team, draw);
  const [shown, setShown] = useState(() => ({ key, text: make(Math.random()), at: Date.now() }));
  useEffect(() => {
    if (key === shown.key) return;
    const t = setTimeout(() => setShown({ key, text: make(Math.random()), at: Date.now() }), Math.max(0, shown.at + HOLD_MS - Date.now()));
    return () => clearTimeout(t);
  });
  return shown.text;
}
