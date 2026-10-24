// Two small helpers several modules share.
import { timingSafeEqual } from "node:crypto";

/**
 * Callbacks for one kind of change. Services announce changes through these (`emit`), and the terminal
 * hub forwards them to browsers (`on`). Delivery is synchronous, in registration order. A listener that throws is
 * logged and the others still hear about it; the service that announced the change never sees the error.
 */
export function listeners<Args extends unknown[] = []>() {
  const fns = new Set<(...args: Args) => void>();
  return {
    /** Returns a function that removes `fn` again. */
    on: (fn: (...args: Args) => void) => (fns.add(fn), () => void fns.delete(fn)),
    emit: (...args: Args) =>
      fns.forEach((fn) => {
        try {
          fn(...args);
        } catch (e) {
          console.error("listener failed:", e);
        }
      }),
  };
}

/** Whether a secret someone sent matches the expected one, in constant time. Missing ones never match. */
export function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
