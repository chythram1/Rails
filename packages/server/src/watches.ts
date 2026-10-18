// Sprocket watches (step 3): Rails wakes a project's Coordinator when one of its sessions waits for the
// user, so the Coordinator can tell the user what the session needs (and, later, suggest the answer).
// Deciding when to wake it is plain code, so idle projects cost nothing:
// - a session asks in a dialog or a form (Claude Code's AskUserQuestion, a pi question tool, Codex's
//   request for input), or ends its turn with a question (looksLikeQuestion);
// - the user gets a moment to answer first (GRACE_MS): anything the session does meanwhile (a new prompt,
//   a tool, the answer) means it's moving again, and nothing wakes;
// - one wake per wait, and at most one per session per COOLDOWN_MS, as a guard against loops (a wait that
//   comes sooner wakes it once the cooldown is over, if the session is still waiting then).
// Permission prompts never wake it, nor other dialogs pi extensions show (they may be approvals): Sprockets
// don't answer those, and the tab's attention mark covers them.
import type { SessionQuestion, SprocketEvent } from "@rails/shared";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { onEvents, onPanelForgotten } from "./bridge/index.ts";
import { panels, projects, sprockets } from "./db.ts";
import { sessionsFor } from "./providers/index.ts";
import { postEvent } from "./sprockets.ts";

/** How long the user has to answer a session themselves before its Coordinator wakes. */
export const GRACE_MS = 20_000;
/** Least time between two wakes for the same session. */
export const COOLDOWN_MS = 60_000;
/** How much of a final message an event keeps: its end, where the question is. */
const TAIL = 600;

/** What a session is waiting for, as its Coordinator hears it. */
export interface Wake {
  what: SprocketEvent["what"];
  /** The question(s), or the end of the session's last message. */
  text: string;
  questions?: SessionQuestion[];
}

// Phrases that ask the user for something even without a question mark. Pleasantries ("let me know if you
// have questions", "anything else?") are left out on purpose: many replies end with one.
const PLEASANTRY = /^(is there )?anything else\b|^(do you have )?any (other |more )?questions\b/;
const LIST_ITEM = /^([-*\u2022]|\d+[.)])\s/;
const ASKS = [
  /\b(should|shall) i\b/,
  /\b(do|would) you (want|like|prefer)\b/,
  /\bwant me to\b/,
  /\bwhich (one|option|approach|way|of these)\b/,
  /\b(please )?confirm\b/,
  /\blet me know (which|whether|how|what|if you('d| would) like|if you want|if i should)\b/,
  /\b(your call|up to you)\b/,
  /\b(waiting|awaiting) (for )?your\b/,
  /\bneeds? your (input|decision|approval|go-ahead|answer)\b/,
  /\bbefore i (proceed|continue|go ahead)\b/,
];

/** Whether a line's last sentence asks the user something. */
function asks(line: string): boolean {
  const sentence = (line.replace(/[*_]+/g, "").split(/(?<=[.!?])\s+/).at(-1) ?? "").trim().toLowerCase();
  if (PLEASANTRY.test(sentence)) return false;
  return /\?["')\]]*$/.test(sentence) || ASKS.some((re) => re.test(sentence));
}

/**
 * Whether a message ends by asking the user something: its last sentence, or the line above the options
 * it lists last ("Which do you prefer?" then "1. A", "2. B"). A question earlier on ("Why did it fail? The
 * cache was stale.") doesn't count. Code and URLs are skipped, so `a ? b : c` or `?page=2` don't either.
 */
export function looksLikeQuestion(text: string): boolean {
  const lines = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\bhttps?:\/\/\S+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  if (asks(lines.at(-1)!)) return true;
  const above = lines.findLastIndex((l) => !LIST_ITEM.test(l));
  return above >= 0 && above < lines.length - 1 && asks(lines[above]);
}

/** The end of a message, from the start of a line where possible. */
function tail(text: string): string {
  if (text.length <= TAIL) return text;
  const cut = text.slice(-TAIL);
  const line = cut.indexOf("\n");
  return "…" + (line >= 0 && line < TAIL / 2 ? cut.slice(line + 1) : cut);
}

/** What one event means for a watch: a wait to wake the Coordinator for, the end of a wait, or nothing. */
export function admit(e: SessionEvent): Wake | "over" | null {
  switch (e.kind) {
    case "waiting":
      if (e.questions?.length) return { what: "question", text: e.questions.map((q) => q.question).join("\n"), questions: e.questions };
      if (ASKING.has(e.reason)) return { what: "question", text: `It's waiting for ${e.reason}.` };
      // Permissions and approvals, and other dialogs from pi extensions (which may well be approvals too):
      // only the user answers those.
      return null;
    case "turn_end":
      return looksLikeQuestion(e.text) ? { what: "turn_end", text: tail(e.text) } : "over";
    case "start":
      return null;
    default:
      return "over"; // a prompt, a tool, an answer, a failure, the end: it's moving (or gone)
  }
}

/** Wakes waiting for their grace period, per panel, and when each panel last woke its Coordinator. */
export class Watches {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private last = new Map<string, number>();
  /** Panels whose current wait already woke the Coordinator (agents may report one wait more than once). */
  private woken = new Set<string>();

  /** `fire` wakes the Coordinator and says whether it did (there may be none). */
  constructor(private fire: (panelId: string, wake: Wake) => boolean) {}

  handle(panelId: string, events: SessionEvent[]): void {
    for (const e of events) {
      const a = admit(e);
      if (a === "over") {
        this.cancel(panelId);
        this.woken.delete(panelId);
      } else if (a) this.arm(panelId, a);
    }
  }

  private arm(panelId: string, wake: Wake) {
    // The same wait reported twice (pi reports its question tool, then the dialog): the first, with the questions, stands.
    if (this.pending.has(panelId) || this.woken.has(panelId)) return;
    const delay = Math.max(GRACE_MS, (this.last.get(panelId) ?? -Infinity) + COOLDOWN_MS - Date.now());
    const timer = setTimeout(() => {
      this.pending.delete(panelId);
      if (!this.fire(panelId, wake)) return;
      this.last.set(panelId, Date.now());
      this.woken.add(panelId);
    }, delay);
    timer.unref?.();
    this.pending.set(panelId, timer);
  }

  private cancel(panelId: string) {
    clearTimeout(this.pending.get(panelId));
    this.pending.delete(panelId);
  }

  /** The panel closed. */
  forget(panelId: string): void {
    this.cancel(panelId);
    this.last.delete(panelId);
    this.woken.delete(panelId);
  }
}

/** Put a waiting session in its project's Coordinator's chat, and wake it. False when there's none. */
function wakeCoordinator(panelId: string, wake: Wake): boolean {
  const panel = panels.get(panelId);
  if (!panel || panel.kind === "shell") return false;
  const coordinator = sprockets.coordinatorOf(panel.projectId);
  const project = projects.get(panel.projectId);
  if (!coordinator || !project) return false;
  // Titled like the tab and the board: by the session's own title when discovery knows it.
  void sessionsFor(project.path)
    .catch(() => [])
    .then((found) => {
      const title = (panel.sessionId && found.find((s) => s.id === panel.sessionId)?.title) || panel.title;
      const event: SprocketEvent = {
        panelId,
        kind: panel.kind,
        title,
        ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
        what: wake.what,
        ...(wake.questions ? { questions: wake.questions } : {}),
      };
      // Still this project's Coordinator (the lookup took a moment)?
      const now = sprockets.get(coordinator.id);
      if (now?.coordinator && now.projectId === panel.projectId) postEvent(coordinator.id, event, wake.text);
    });
  return true;
}

/** Follow every session the bridge hears from. */
export function startWatches(): void {
  const watches = new Watches(wakeCoordinator);
  onEvents((panel, events) => {
    try {
      watches.handle(panel.id, events);
    } catch (e) {
      console.error("watches:", e);
    }
  });
  onPanelForgotten((id) => watches.forget(id));
}
