// Suggested replies (ADR 0010). A Coordinator drafts what its user could answer a session (suggest_reply),
// or a message the user asked it to pass on (suggest_message); the user sends it, edited or not, or dismisses
// it. A dialog's answer is picked in the panel instead: Rails never types into one. Everything is checked
// again when the user sends. An answer expires as soon as its session moves on (a new prompt, a tool, the
// dialog answered); a message doesn't, and a busy session gets it in its own queue, after its current turn.
import type { Panel, Suggestion } from "@rails/shared";
import type { SessionCard } from "./bridge/board.ts";
import { deliver } from "./bridge/deliver.ts";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { cardOf, onEvents, onPanelForgotten, onReturned } from "./bridge/index.ts";
import { panels, sprockets, suggestions } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { listeners } from "./util.ts";

/** Longest reply a Coordinator may suggest. */
export const SUGGESTION_MAX = 2000;
/** Most messages one Coordinator can have waiting for one session (they don't replace each other). */
export const MAX_PENDING_MESSAGES = 3;
/** Longest reply the user may send (after editing one). */
export const REPLY_MAX = 4000;

const changes = listeners();
/** A suggestion was made, sent, dismissed or expired. */
export const onSuggestionsChanged = changes.on;

type Stored = NonNullable<ReturnType<typeof suggestions.get>>;
const shown = ({ sprocketId: _s, messageId: _m, ...s }: Stored): Suggestion => s;

/**
 * What a Coordinator can suggest for a session in this state: an answer to its question (a reply, or a
 * dialog's answer), a message whatever it's doing, or nothing (why).
 */
function modeFor(card: SessionCard, title: string, purpose: Purpose): Suggestion["mode"] {
  if (card.status === "ended") throw new Error(`"${title}" has ended.`);
  if (purpose === "message") return "message";
  switch (card.status) {
    case "waiting":
      if (card.waitingFor === "question" || ASKING.has(card.waitingFor ?? "")) return "answer";
      throw new Error(`"${title}" is waiting for a permission or an approval, which only your user gives, in its panel.`);
    case "working":
      throw new Error(`"${title}" is working right now: it isn't asking anything. To pass on something your user asked, use suggest_message.`);
    default:
      return "reply"; // its turn ended (or failed): a message starts the next one
  }
}

/** An answer to the session's question, or a message the user asked to pass on. */
export type Purpose = "answer" | "message";

/**
 * A Coordinator suggests an answer to a session (following one of its rules, by its text, or its own
 * judgment) or a message for it. A session's question has one answer, so a new answer replaces the
 * Coordinator's earlier pending one. Messages are separate things to pass on (a handoff, a heads-up), so they
 * don't replace anything, up to MAX_PENDING_MESSAGES.
 */
export function suggest(
  sprocketId: string,
  panel: Panel,
  title: string,
  raw: string,
  { rule, purpose = "answer", attachment }: { rule?: string; purpose?: Purpose; attachment?: Suggestion["attachment"] } = {},
): Suggestion {
  const text = raw.trim();
  if (!text) throw new Error("The text is empty.");
  if (text.length > SUGGESTION_MAX) throw new Error(`It can be at most ${SUGGESTION_MAX} characters; this is ${text.length}.`);
  const mode = modeFor(cardOf(panel), title, purpose);
  const mine = suggestions.pendingFor(panel.id).filter((s) => s.sprocketId === sprocketId);
  if (mode === "message") {
    if (mine.filter((s) => s.mode === "message").length >= MAX_PENDING_MESSAGES)
      throw new Error(`${MAX_PENDING_MESSAGES} of your messages for "${title}" already wait for your user. Say what you'd add in your reply instead.`);
  } else
    for (const old of mine.filter((s) => s.mode !== "message")) {
      if (old.messageId) suggestions.setStatus(old.id, ["pending"], "replaced");
      else suggestions.drop([old.id]); // from this same run: never shown
    }
  const s = suggestions.create({ sprocketId, panelId: panel.id, kind: panel.kind, title, sessionId: panel.sessionId, mode, text, rule, attachment });
  changes.emit();
  return shown(s);
}

/**
 * Why this can't go into the session now, if it can't. A message can wait in the session's queue; an answer
 * can't. Shown on the card under the session's name, so it says "the session", not its (long) title.
 */
function blocked(card: SessionCard, mode: Suggestion["mode"]): string | undefined {
  if (card.status === "ended") return "The session has ended.";
  if (mode === "message") return undefined;
  if (card.status === "working") return "The session is working on something else now.";
  if (card.status === "waiting") return "The session is waiting for you in its panel.";
}

/** What a session gets: the text, and a handoff's attachment under it, marked as the other session's words. */
export function deliveredText(text: string, attachment?: Suggestion["attachment"]): string {
  return attachment ? `${text}\n\n---\nWhat "${attachment.title}" said when it finished, word for word:\n\n${attachment.text}` : text;
}

/** The user sends a suggested reply, possibly edited. */
export async function sendSuggestion(id: string, rawText: unknown): Promise<Suggestion> {
  const s = suggestions.get(id);
  if (!s?.messageId) throw new ServiceError("Not found", 404);
  if (s.mode === "answer") throw new ServiceError("Answer it in the session's panel.", 400);
  if (s.status === "sent" || s.status === "sending") throw new ServiceError("It's already sent.", 409);
  if (s.status !== "pending" && s.status !== "failed") throw new ServiceError("It can't be sent anymore.", 409);
  const text = typeof rawText === "string" ? rawText.trim() : s.text;
  if (!text) throw new ServiceError("The reply is empty.", 400);
  if (text.length > REPLY_MAX) throw new ServiceError(`Replies can be at most ${REPLY_MAX} characters.`, 400);

  const panel = panels.get(s.panelId);
  const card = panel && cardOf(panel);
  const why = !panel || !card ? "The panel was closed." : panel.projectId !== sprockets.get(s.sprocketId)?.projectId ? "It's not in this project anymore." : blocked(card, s.mode);
  if (why) {
    if (suggestions.setStatus(id, ["pending", "failed"], "expired", { error: why })) changes.emit();
    throw new ServiceError(why, 409);
  }
  if (!suggestions.setStatus(id, ["pending", "failed"], "sending", { text })) throw new ServiceError("It's already being sent.", 409);
  changes.emit();
  try {
    const { queued } = await deliver(panel!, card!, deliveredText(text, s.attachment), { queue: s.mode === "message" });
    suggestions.setStatus(id, ["sending"], "sent", { queued });
  } catch (e) {
    suggestions.setStatus(id, ["sending"], "failed", { error: (e as Error).message });
  }
  changes.emit();
  return shown(suggestions.get(id)!);
}

export function dismissSuggestion(id: string): Suggestion {
  const s = suggestions.get(id);
  if (!s?.messageId) throw new ServiceError("Not found", 404);
  if (!suggestions.setStatus(id, ["pending", "failed"], "dismissed")) throw new ServiceError("It can't be dismissed anymore.", 409);
  changes.emit();
  return shown(suggestions.get(id)!);
}

/** The session did something, so an answer suggested for it no longer fits. */
const movesOn = (e: SessionEvent) => e.kind === "prompt" || e.kind === "tool" || e.kind === "resumed" || e.kind === "stopped";

/** Expire a panel's pending answers, or (`all`) its messages too. */
function expireFor(panelId: string, { all = false, error }: { all?: boolean; error?: string } = {}) {
  let any = false;
  for (const s of suggestions.pendingFor(panelId))
    if (all || s.mode !== "message") any = suggestions.setStatus(s.id, ["pending"], "expired", error ? { error } : {}) || any;
  if (any) changes.emit();
}

/** Expire suggestions as sessions move on (answers) or end (everything). */
/** pi put a queued message back in its editor when the user stopped its run: it wasn't sent after all. */
function returned(panelId: string, text: string): void {
  for (const s of suggestions.sentTo(panelId))
    if (s.queued && deliveredText(s.text, s.attachment) === text && suggestions.setStatus(s.id, ["sent"], "expired", { error: "pi put it back in its input box when its turn was stopped. Send it from there." }))
      changes.emit();
}

export function startSuggestions(): void {
  onReturned(returned);
  onEvents((panel, events) => {
    if (events.some((e) => e.kind === "ended")) expireFor(panel.id, { all: true, error: "The session ended." });
    else if (events.some(movesOn)) expireFor(panel.id);
  });
  onPanelForgotten((panelId) => expireFor(panelId, { all: true, error: "The panel was closed." }));
}
