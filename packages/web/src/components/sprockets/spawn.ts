// A Sprocket just made, on this device: its row in the list gathers itself into being (morph.ts, GATHER), and the icon
// by its first reply in flight, which mirrors the row (ADR 0035), with it.
import { useSyncExternalStore } from "react";
import { GATHER } from "./morph.ts";

/** When each was made here (performance.now()), while its spawn plays. */
const born = new Map<string, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Sprocket `id` was just made: play its spawn. */
export function spawned(id: string) {
  born.set(id, performance.now());
  emit();
  setTimeout(() => (born.delete(id), emit()), GATHER.ms + GATHER.grow + 100);
}

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** When Sprocket `id`'s spawn started, while it plays (undefined otherwise). */
export const useSpawn = (id: string) => useSyncExternalStore(subscribe, () => born.get(id));
