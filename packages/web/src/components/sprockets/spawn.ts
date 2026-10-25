// A Sprocket just made, on this device: its row in the list gathers itself into being (morph.ts, GATHER), then plays
// Satisfied, pleased to be here, as after a reply; the icon by a reply in flight in its direct chat, which mirrors the
// row (ADR 0035), shows both.
import { useSyncExternalStore } from "react";
import { ANIMATIONS } from "./animations.ts";
import { GATHER } from "./morph.ts";

/** A spawn: when it started (performance.now()), and whether it has gathered itself and now plays Satisfied. */
export interface Spawn {
  start: number;
  settled: boolean;
}

const spawns = new Map<string, Spawn>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** How long it gathers itself (ms), then how long it's pleased about it. */
const GATHERED = GATHER.ms + GATHER.grow;
const SETTLED = ANIMATIONS.satisfied.ms;

/** Sprocket `id` was just made: play its spawn. */
export function spawned(id: string) {
  const start = performance.now();
  spawns.set(id, { start, settled: false });
  emit();
  setTimeout(() => (spawns.set(id, { start, settled: true }), emit()), GATHERED);
  setTimeout(() => (spawns.delete(id), emit()), GATHERED + SETTLED);
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Sprocket `id`'s spawn while it plays (undefined otherwise). */
export const useSpawn = (id: string) => useSyncExternalStore(subscribe, () => spawns.get(id));

/** What a Sprocket plays as its spawn settles: Satisfied, once. */
export const settledPlay = (s: Spawn | undefined) => (s?.settled ? { name: "satisfied" as const, key: `spawn-${s.start}` } : undefined);
