// Which panels are busy: the program in them keeps printing output, as an agent does while it thinks
// (its spinner) and replies. tmux records each panel's last output time, to the second, even when no
// browser is attached, so this works for panels nobody is looking at.
import * as tmux from "./tmux.ts";

const POLL_MS = 1000;
/** A busy panel turns idle after this many seconds without output. */
const IDLE_AFTER_S = 2;

/**
 * Poll tmux and call `onChange` with the busy panel ids whenever they change. A panel only turns busy
 * after printing in two polls in a row: idle agents print the odd one-off update (Claude refreshes its
 * status line), which shouldn't count. Returns a function that stops watching.
 */
export function watchBusy(onChange: (panelIds: string[]) => void): () => void {
  let lastOutput = new Map<string, number>();
  let streak = new Map<string, number>();
  let busy = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const poll = async () => {
    const activity = await tmux.panelActivity().catch(() => new Map<string, number>());
    const now = Date.now() / 1000;
    const nextStreak = new Map<string, number>();
    const next = new Set<string>();
    for (const [id, t] of activity) {
      const printed = t > (lastOutput.get(id) ?? Infinity);
      nextStreak.set(id, printed ? (streak.get(id) ?? 0) + 1 : 0);
      if (busy.has(id) ? now - t < IDLE_AFTER_S : nextStreak.get(id)! >= 2) next.add(id);
    }
    lastOutput = activity;
    streak = nextStreak;
    const changed = next.size !== busy.size || [...next].some((id) => !busy.has(id));
    busy = next;
    if (stopped) return;
    if (changed) onChange([...busy]);
    timer = setTimeout(poll, POLL_MS);
  };
  void poll();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
