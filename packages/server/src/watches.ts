// Sprocket watches (step 3): Rails wakes a project's Coordinator when one of its sessions waits for the
// user, so the Coordinator can tell the user what the session needs (and, later, suggest the answer).
// Deciding when to wake it is plain code, so idle projects cost nothing:
// - a session asks in a dialog or a form (Claude Code's AskUserQuestion, a pi question tool, Codex's
//   request for input), or ends its turn with a question (looksLikeQuestion);
// - the user gets a moment to answer first (GRACE_MS): anything the session does meanwhile (a new prompt,
//   a tool, the answer) means it's moving again, and nothing wakes;
// - one wake per wait, and at most one per session per COOLDOWN_MS, as a guard against loops (a wait that
//   comes sooner wakes it once the cooldown is over, if the session is still waiting then).
// - a session waits for the user's permission (Claude Code's permission prompt, Codex's approval, a dialog from
//   a pi extension Rails doesn't know), past the same grace period (ADR 0026): neither Rails nor the Coordinator
//   can give it, but the Coordinator tells the user what it's for and what its rules say. In test run 7 a Codex
//   sat for minutes on an approval nobody saw, as the user was in the chat.
// A turn that ends without a question also wakes the Coordinator for each handoff waiting on that session
// (ADR 0015, handoffs.ts).
import type { Panel, SessionQuestion, SprocketEvent } from "@rails/shared";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { onEvents, onPanelForgotten } from "./bridge/index.ts";
import { handoffs, panels, sprockets, type StoredHandoff } from "./db.ts";
import { end as endHandoff, followSessions } from "./handoffs.ts";
import { postEvent } from "./sprockets.ts";
import { sessionTitle } from "./titles.ts";
import { listeners } from "./util.ts";

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
  /** Set when the decision model added this wake (ADR 0013): its judgment, to link the outcome to. */
  decisionId?: string;
  /** A permission whose purpose isn't known yet (Codex says it waits before it says what for). */
  vague?: boolean;
  /** A question the session may go on working past (Codex's, ADR 0027): its tools don't mean it was answered. */
  goesOn?: boolean;
}

/** A permission wait as the Coordinator reads it: what it's for, as far as the agent said. */
function permission(e: Extract<SessionEvent, { kind: "waiting" }>): Wake {
  if (e.reason === "approval") return e.detail ? { what: "permission", text: e.detail } : { what: "permission", text: "It's waiting for an approval.", vague: true };
  if (e.reason.startsWith("permission for ")) return { what: "permission", text: e.detail ?? `It asks permission to use ${e.reason.slice(15)}.` };
  // A pi extension's dialog: often an approval, sometimes a question (the decision model may say which).
  const titled = e.reason === "a prompt" ? "A dialog with no title." : `A dialog titled ${JSON.stringify(e.reason)}.`;
  return { what: "permission", text: e.detail ? `${titled}\n${e.detail}` : titled };
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
      if (e.questions?.length)
        return { what: "question", text: e.questions.map((q) => q.question).join("\n"), questions: e.questions, ...(e.dialog?.kind === "steer" ? { goesOn: true } : {}) };
      if (ASKING.has(e.reason)) return { what: "question", text: `It's waiting for ${e.reason}.` };
      // Permissions and approvals, and other dialogs from pi extensions (which may well be approvals too).
      return permission(e);
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
  /** Armed wakes: their timer, and the wake, which a better account of the same wait may replace meanwhile. */
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; wake: Wake }>();
  private last = new Map<string, number>();
  /** Panels whose current wait already woke the Coordinator (agents may report one wait more than once). */
  private woken = new Set<string>();
  /** How many events each panel has reported, so a late judgment can tell whether the session moved on. */
  private seen = new Map<string, number>();
  /** Panels waiting on a question they may work on past (`goesOn`): only a prompt or the turn's end answers it. */
  private workingOn = new Set<string>();

  /** `fire` wakes the Coordinator and says whether it did (there may be none). */
  constructor(private fire: (panelId: string, wake: Wake) => boolean) {}

  handle(panelId: string, events: SessionEvent[]): void {
    this.seen.set(panelId, (this.seen.get(panelId) ?? 0) + events.length);
    for (const e of events) {
      const a = admit(e);
      if (a === "over") {
        if (e.kind === "tool" && this.workingOn.has(panelId)) continue;
        this.workingOn.delete(panelId);
        this.cancel(panelId);
        this.woken.delete(panelId);
      } else if (a) {
        if (a.goesOn) this.workingOn.add(panelId);
        this.arm(panelId, a);
      }
    }
  }

  /** Where a panel's events are up to (see `armIfStill`). */
  position(panelId: string): number {
    return this.seen.get(panelId) ?? 0;
  }

  /**
   * Arm a wake someone else decided on (the decision model, ADR 0013), unless the session has reported
   * anything since `position`: then it has moved on and the judgment is stale. The usual grace, cooldown and
   * one-wake-per-wait rules apply. False when it isn't armed.
   */
  armIfStill(panelId: string, position: number, wake: Wake): boolean {
    if (this.position(panelId) !== position || this.woken.has(panelId)) return false;
    const armed = this.pending.get(panelId);
    // A dialog the model takes for a question was armed as a permission: it's that question now.
    if (armed && !(armed.wake.what === "permission" && wake.what === "question")) return false;
    this.arm(panelId, wake);
    return true;
  }

  private arm(panelId: string, wake: Wake) {
    if (this.woken.has(panelId)) return;
    const armed = this.pending.get(panelId);
    if (armed) {
      // The same wait reported twice (pi reports its question tool, then the dialog): the first, with the questions,
      // stands; but a permission learns what it's for (Codex's request after its status), and a dialog the decision
      // model took for a question becomes one.
      if (armed.wake.what === "permission" && (wake.what === "question" || (armed.wake.vague && wake.what === "permission" && !wake.vague))) armed.wake = wake;
      return;
    }
    const delay = Math.max(GRACE_MS, (this.last.get(panelId) ?? -Infinity) + COOLDOWN_MS - Date.now());
    const timer = setTimeout(() => {
      const now = this.pending.get(panelId)?.wake ?? wake;
      this.pending.delete(panelId);
      if (!this.fire(panelId, now)) return;
      this.last.set(panelId, Date.now());
      this.woken.add(panelId);
    }, delay);
    timer.unref?.();
    this.pending.set(panelId, { timer, wake });
  }

  private cancel(panelId: string) {
    clearTimeout(this.pending.get(panelId)?.timer);
    this.pending.delete(panelId);
  }

  /** The panel closed. */
  forget(panelId: string): void {
    this.cancel(panelId);
    this.last.delete(panelId);
    this.woken.delete(panelId);
    this.seen.delete(panelId);
    this.workingOn.delete(panelId);
  }
}

const woke = listeners<[panelId: string, eventMessageId: string, wake: Wake]>();
/** A Coordinator was woken for a session, with this event message and why (decisions.ts links its judgment). */
export const onWake = woke.on;

/** Put a waiting session in its project's Coordinator's chat, and wake it. False when there's none. */
function wakeCoordinator(panelId: string, wake: Wake): boolean {
  const panel = panels.get(panelId);
  if (!panel || panel.kind === "shell") return false;
  const coordinator = sprockets.coordinatorOf(panel.projectId);
  if (!coordinator) return false;
  void sessionTitle(panel).then((title) => {
    const event: SprocketEvent = {
      panelId,
      kind: panel.kind,
      title,
      ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
      what: wake.what,
      ...(wake.questions ? { questions: wake.questions } : {}),
      ...(wake.decisionId ? { byModel: true } : {}),
    };
    // Still this project's Coordinator (the lookup took a moment)?
    const now = sprockets.get(coordinator.id);
    if (now?.coordinator && now.projectId === panel.projectId) woke.emit(panelId, postEvent(coordinator.id, event, wake.text).id, wake);
  });
  return true;
}

/**
 * A session a handoff waits for finished a turn (ADR 0015): wake its Coordinator, if it still is one, to check the
 * work is done and draft the message.
 */
async function wakeForHandoff(h: StoredHandoff, from: Panel, text: string): Promise<void> {
  const s = sprockets.get(h.sprocketId);
  if (!s?.coordinator || s.projectId !== from.projectId) return void endHandoff(h, "cancelled", "its Sprocket isn't this project's Coordinator anymore.");
  const to = panels.get(h.to.panelId);
  if (!to) return void endHandoff(h, "cancelled", `\u201c${h.to.title}\u201d was closed.`);
  const [title, toTitle] = await Promise.all([sessionTitle(from), sessionTitle(to)]);
  const event: SprocketEvent = {
    panelId: from.id,
    kind: from.kind,
    title,
    ...(from.sessionId ? { sessionId: from.sessionId } : {}),
    what: "handoff",
    handoff: { id: h.id, to: { panelId: to.id, kind: to.kind, title: toTitle, ...(to.sessionId ? { sessionId: to.sessionId } : {}) }, note: h.note },
  };
  // Still pending, and still its Coordinator (the lookups took a moment)?
  const now = sprockets.get(h.sprocketId);
  if (now?.coordinator && now.projectId === from.projectId && handoffs.pending(h.sprocketId).some((x) => x.id === h.id)) postEvent(h.sprocketId, event, tail(text));
}

let watching: Watches | undefined;

/**
 * The decision model asks for a wake (ADR 0013). `position` is where the panel's events were when it was asked;
 * nothing wakes if the session has moved on since. False when it isn't armed.
 */
export function wakeFromModel(panelId: string, position: number, wake: Wake): boolean {
  return watching?.armIfStill(panelId, position, wake) ?? false;
}

/** Where a panel's events are up to, for `wakeFromModel`. */
export const eventPosition = (panelId: string) => watching?.position(panelId) ?? 0;

/** Follow every session the bridge hears from. */
export function startWatches(): void {
  const watches = new Watches(wakeCoordinator);
  watching = watches;
  onEvents((panel, events) => {
    try {
      watches.handle(panel.id, events);
      // A turn that ends asking the user something, or fails, isn't finished.
      for (const e of events)
        if (e.kind === "turn_end" && !looksLikeQuestion(e.text))
          for (const h of followSessions(panel)) if (h.from.panelId === panel.id) void wakeForHandoff(h, panel, e.text).catch((err) => console.error("handoffs:", err));
    } catch (e) {
      console.error("watches:", e);
    }
  });
  onPanelForgotten((id) => watches.forget(id));
}
