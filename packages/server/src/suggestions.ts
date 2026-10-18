// Suggested replies (ADR 0010). A Coordinator drafts what its user could answer a session (the
// suggest_reply capability); the user sends it, edited or not, or dismisses it. A dialog's answer is picked in
// the panel instead: Rails never types into one. Everything is checked again when the user sends, and a
// suggestion expires as soon as its session moves on (a new prompt, a tool, the dialog answered).
import type { Panel, Suggestion } from "@rails/shared";
import type { SessionCard } from "./bridge/board.ts";
import { deliver } from "./bridge/deliver.ts";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { cardOf, onEvents, onPanelForgotten } from "./bridge/index.ts";
import { panels, sprockets, suggestions } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { listeners } from "./util.ts";

/** Longest reply a Coordinator may suggest. */
export const SUGGESTION_MAX = 2000;
/** Longest reply the user may send (after editing one). */
export const REPLY_MAX = 4000;

const changes = listeners();
/** A suggestion was made, sent, dismissed or expired. */
export const onSuggestionsChanged = changes.on;

type Stored = NonNullable<ReturnType<typeof suggestions.get>>;
const shown = ({ sprocketId: _s, messageId: _m, ...s }: Stored): Suggestion => s;

/** What a Coordinator can suggest for a session in this state: a reply, a dialog's answer, or nothing (why). */
function modeFor(card: SessionCard, title: string): Suggestion["mode"] {
  switch (card.status) {
    case "waiting":
      if (card.waitingFor === "question" || ASKING.has(card.waitingFor ?? "")) return "answer";
      throw new Error(`"${title}" is waiting for a permission or an approval, which only your user gives, in its panel.`);
    case "working":
      throw new Error(`"${title}" is working right now. Suggest a reply once its turn ends.`);
    case "ended":
      throw new Error(`"${title}" has ended.`);
    default:
      return "reply"; // its turn ended (or failed): a message starts the next one
  }
}

/**
 * A Coordinator suggests a reply to a session, following one of its rules (its text) or its own judgment.
 * Its earlier pending suggestion for that session goes.
 */
export function suggest(sprocketId: string, panel: Panel, title: string, raw: string, rule?: string): Suggestion {
  const text = raw.trim();
  if (!text) throw new Error("The reply is empty.");
  if (text.length > SUGGESTION_MAX) throw new Error(`Replies can be at most ${SUGGESTION_MAX} characters; this one is ${text.length}.`);
  const mode = modeFor(cardOf(panel), title);
  for (const old of suggestions.pendingFor(panel.id).filter((s) => s.sprocketId === sprocketId)) {
    if (old.messageId) suggestions.setStatus(old.id, ["pending"], "expired", { error: "A newer suggestion replaced it." });
    else suggestions.drop([old.id]); // from this same run: never shown
  }
  const s = suggestions.create({ sprocketId, panelId: panel.id, kind: panel.kind, title, sessionId: panel.sessionId, mode, text, rule });
  changes.emit();
  return shown(s);
}

/** Why a reply can't go into this session now, if it can't. */
function blocked(card: SessionCard, title: string): string | undefined {
  if (card.status === "working") return `${title} is working on something else now.`;
  if (card.status === "waiting") return `${title} is waiting for you in its panel.`;
  if (card.status === "ended") return `${title} has ended.`;
}

/** The user sends a suggested reply, possibly edited. */
export async function sendSuggestion(id: string, rawText: unknown): Promise<Suggestion> {
  const s = suggestions.get(id);
  if (!s?.messageId) throw new ServiceError("Not found", 404);
  if (s.mode !== "reply") throw new ServiceError("Answer it in the session's panel.", 400);
  if (s.status === "sent" || s.status === "sending") throw new ServiceError("It's already sent.", 409);
  if (s.status !== "pending" && s.status !== "failed") throw new ServiceError("It can't be sent anymore.", 409);
  const text = typeof rawText === "string" ? rawText.trim() : s.text;
  if (!text) throw new ServiceError("The reply is empty.", 400);
  if (text.length > REPLY_MAX) throw new ServiceError(`Replies can be at most ${REPLY_MAX} characters.`, 400);

  const panel = panels.get(s.panelId);
  const card = panel && cardOf(panel);
  const why = !panel || !card ? "The panel was closed." : panel.projectId !== sprockets.get(s.sprocketId)?.projectId ? "It's not in this project anymore." : blocked(card, s.title);
  if (why) {
    if (suggestions.setStatus(id, ["pending", "failed"], "expired", { error: why })) changes.emit();
    throw new ServiceError(why, 409);
  }
  if (!suggestions.setStatus(id, ["pending", "failed"], "sending", { text })) throw new ServiceError("It's already being sent.", 409);
  changes.emit();
  try {
    await deliver(panel!, card!, text);
    suggestions.setStatus(id, ["sending"], "sent");
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

/** The session did something, so what was suggested for it no longer fits. */
const movesOn = (e: SessionEvent) => e.kind === "prompt" || e.kind === "tool" || e.kind === "resumed" || e.kind === "ended";

function expireFor(panelId: string, error?: string) {
  let any = false;
  for (const s of suggestions.pendingFor(panelId)) any = suggestions.setStatus(s.id, ["pending"], "expired", error ? { error } : {}) || any;
  if (any) changes.emit();
}

/** Expire suggestions as sessions move on. */
export function startSuggestions(): void {
  onEvents((panel, events) => {
    if (events.some(movesOn)) expireFor(panel.id);
  });
  onPanelForgotten((panelId) => expireFor(panelId, "The panel was closed."));
}
