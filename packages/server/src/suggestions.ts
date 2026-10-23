// Suggested replies (ADR 0010). A Coordinator drafts what its user could answer a session (suggest_reply),
// or a message the user asked it to pass on (suggest_message); the user sends it, edited or not, or dismisses
// it. A dialog's answer is picked in the panel, except pi dialogs Rails can answer through its extension
// (ADR 0027): Rails never types into a panel. Everything is checked
// again when the user sends. An answer expires as soon as its session moves on (a new prompt, a tool, the
// dialog answered); a message doesn't, and a busy session gets it in its own queue, after its current turn.
import { shortTitle, type Panel, type Suggestion } from "@rails/shared";
import { AGENT, type SessionCard } from "./bridge/board.ts";
import { claudeInbox, deliver, piInbox } from "./bridge/deliver.ts";
import { steerCodex } from "./bridge/codex.ts";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { cardOf, onEvents, onPanelForgotten, onReturned } from "./bridge/index.ts";
import { panels, sessionEvents, sprockets, suggestions } from "./db.ts";
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

/** How an option's label and a drafted answer are compared: case, quotes, end punctuation and "(Recommended)" aside. */
const plain = (s: string) =>
  s
    .trim()
    .replace(/\s*\(recommended\)\s*$/i, "")
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * What answer a drafted text gives the pi dialog a session waits on, if Rails can give it (ADR 0027): one of a
 * select's options, an input's text, or a single-question questionnaire's option (or, not matching one, its typed
 * answer). Dialogs with several questions, and drafts that match no option of a select, are answered in the panel.
 */
export function dialogAnswer(dialog: SessionCard["dialog"], text: string): Suggestion["dialog"] {
  if (!dialog || dialog.questions !== 1 || !text.trim()) return undefined;
  const option = dialog.options.findIndex((o) => plain(o) === plain(text));
  // Codex and Claude Code take the answer as text: the option's own label when the draft names one.
  if (dialog.kind === "steer" || dialog.kind === "claude") return { id: dialog.id, text: option >= 0 ? dialog.options[option] : text.trim() };
  if (dialog.kind === "select") return option >= 0 ? { id: dialog.id, option } : undefined;
  if (dialog.kind === "questionnaire" && option >= 0) return { id: dialog.id, option };
  return { id: dialog.id, text: text.trim() };
}

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
 * don't replace anything, up to MAX_PENDING_MESSAGES; except that an agent's message (`from`, ADR 0018) replaces
 * the same agent's earlier one for that session while it still waits, so the user sees its latest word once.
 */
export function suggest(
  sprocketId: string,
  panel: Panel,
  title: string,
  raw: string,
  { rule, purpose = "answer", attachment, from }: { rule?: string; purpose?: Purpose; attachment?: Suggestion["attachment"]; from?: Suggestion["from"] } = {},
): Suggestion {
  const text = raw.trim();
  if (!text) throw new Error("The text is empty.");
  if (text.length > SUGGESTION_MAX) throw new Error(`It can be at most ${SUGGESTION_MAX} characters; this is ${text.length}.`);
  const mode = modeFor(cardOf(panel), title, purpose);
  const mine = suggestions.pendingFor(panel.id).filter((s) => s.sprocketId === sprocketId);
  if (mode === "message") {
    const replaced = from ? mine.filter((s) => s.mode === "message" && s.from?.panelId === from.panelId) : [];
    if (mine.filter((s) => s.mode === "message").length - replaced.length >= MAX_PENDING_MESSAGES)
      throw new Error(`${MAX_PENDING_MESSAGES} of your messages for "${title}" already wait for your user. Say what you'd add in your reply instead.`);
    for (const old of replaced) suggestions.setStatus(old.id, ["pending"], "replaced");
  } else
    for (const old of mine.filter((s) => s.mode !== "message")) {
      if (old.messageId) suggestions.setStatus(old.id, ["pending"], "replaced");
      else suggestions.drop([old.id]); // from this same run: never shown
    }
  const dialog = mode === "answer" && panel.kind !== "shell" ? dialogAnswer(cardOf(panel).dialog, text) : undefined;
  const s = suggestions.create({ sprocketId, panelId: panel.id, kind: panel.kind, title, sessionId: panel.sessionId, mode, text, rule, attachment, from, dialog });
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

/**
 * What a session gets: the text, and a handoff's attachment under it, marked as the other session's words. An
 * agent's message (ADR 0018) starts with which session wrote it.
 */
export function deliveredText(text: string, attachment?: Suggestion["attachment"], from?: Suggestion["from"]): string {
  // The title and id as neighbours shows them (agentTools.ts), so the session can answer with the message tool.
  const said = from
    ? `A message from the session "${shortTitle(from.title, 60)}" (${AGENT[from.kind]}, id ${from.panelId.slice(0, 8)}) in this project; your user read it and sent it on:\n\n${text}`
    : text;
  return attachment ? `${said}\n\n---\nWhat "${attachment.title}" said when it finished, word for word:\n\n${attachment.text}` : said;
}

/** The user sends a suggested reply, possibly edited. */
export async function sendSuggestion(id: string, rawText: unknown): Promise<Suggestion> {
  const s = suggestions.get(id);
  if (!s?.messageId) throw new ServiceError("Not found", 404);
  if (s.mode === "answer" && !s.dialog) throw new ServiceError("Answer it in the session's panel.", 400);
  if (s.status === "sent" || s.status === "sending") throw new ServiceError("It's already sent.", 409);
  if (s.mode === "answer") return answerDialog(s);
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
  if (!suggestions.setStatus(id, ["pending", "failed"], "sending", { text, edited: text !== s.text })) throw new ServiceError("It's already being sent.", 409);
  changes.emit();
  try {
    const sentAt = new Date().toISOString();
    const { queued } = await deliver(panel!, card!, deliveredText(text, s.attachment, s.from), { queue: s.mode === "message" });
    suggestions.setStatus(id, ["sending"], "sent", { queued });
    if (!queued) checkPickup(panel!, id, sentAt);
  } catch (e) {
    suggestions.setStatus(id, ["sending"], "failed", { error: (e as Error).message });
  }
  changes.emit();
  return shown(suggestions.get(id)!);
}

/**
 * Send an answer to the question it was drafted for (ADR 0027), as drafted: a pi dialog's option through the pi
 * extension, or Codex's question by steering its turn. A Codex question whose turn has ended since gets the answer
 * as the next message (it's still asked in the panel's queue).
 */
async function answerDialog(s: Stored): Promise<Suggestion> {
  const panel = panels.get(s.panelId);
  const card = panel && cardOf(panel);
  const open = card?.status === "waiting" && card.dialog?.id === s.dialog!.id;
  const afterTurn = panel?.kind === "codex" && card?.status === "idle";
  const why = !panel || !card ? "The panel was closed." : !open && !afterTurn ? "The dialog has closed." : undefined;
  if (why) {
    if (suggestions.setStatus(s.id, ["pending", "failed"], "expired", { error: why })) changes.emit();
    throw new ServiceError(why, 409);
  }
  if (!suggestions.setStatus(s.id, ["pending", "failed"], "sending")) throw new ServiceError("It's already being sent.", 409);
  changes.emit();
  try {
    if (panel!.kind === "codex") {
      const thread = panel!.sessionId ?? card!.sessionId;
      if (!thread) throw new Error("Rails can't reach this Codex session. Answer it in its panel.");
      await steerCodex(thread, open ? s.dialog!.id : undefined, s.dialog!.text ?? s.text);
    } else await (panel!.kind === "claude" ? claudeInbox : piInbox).answer(panel!.id, s.dialog!);
    suggestions.setStatus(s.id, ["sending"], "sent");
  } catch (e) {
    suggestions.setStatus(s.id, ["sending"], "failed", { error: (e as Error).message });
  }
  changes.emit();
  return shown(suggestions.get(s.id)!);
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
/** For a Codex question it may work on past (ADR 0027), its tools don't count: it's still asked. */
const movesOnFrom = (card: SessionCard | undefined) => (e: SessionEvent) => movesOn(e) && !(e.kind === "tool" && card?.dialog?.kind === "steer");

/** A chat was cleared (ADR 0021): what waited under its replies can't be sent from it anymore. */
export function expireInChat(chatId: string): void {
  let any = false;
  for (const id of suggestions.waitingIn(chatId)) any = suggestions.setStatus(id, ["pending", "failed"], "expired", { error: "The chat was cleared." }) || any;
  if (any) changes.emit();
}

/** Expire a panel's pending answers, or (`all`) its messages too. */
function expireFor(panelId: string, { all = false, error }: { all?: boolean; error?: string } = {}) {
  let any = false;
  for (const s of suggestions.pendingFor(panelId))
    if (all || s.mode !== "message") any = suggestions.setStatus(s.id, ["pending"], "expired", error ? { error } : {}) || any;
  if (any) changes.emit();
}

/** pi put a queued message back in its editor when the user stopped its run: it wasn't sent after all. */
function returned(panelId: string, text: string): void {
  for (const s of suggestions.sentTo(panelId))
    if (s.queued && deliveredText(s.text, s.attachment, s.from) === text && suggestions.setStatus(s.id, ["sent"], "expired", { error: "pi put it back in its input box when its turn was stopped. Send it from there." }))
      changes.emit();
}

/**
 * How long an idle session has to show it took a message. Claude Code reports the prompt it starts within a second
 * (UserPromptSubmit, verified with 2.1.309), Codex its user message item; `ms` is changed only by tests.
 */
export const pickup = { ms: 15_000 };

/**
 * Claude Code's message socket and Codex's queue only accept a message (pi's extension says whether pi took it,
 * deliver.ts): if the idle session it went to reports nothing within `pickup.ms`, the sent card says so, rather than
 * a plain "Sent" the user would trust (the pattern of herdr's prompt-stalled check). Anything it reports later
 * clears it.
 */
function checkPickup(panel: Panel, id: string, sentAt: string): void {
  if (panel.kind !== "claude" && panel.kind !== "codex") return;
  setTimeout(() => {
    const took = sessionEvents.list(panel.id).some((r) => r.at >= sentAt);
    if (!took && suggestions.setUnconfirmed(id, true)) changes.emit();
  }, pickup.ms).unref?.();
}

/** Expire suggestions as sessions move on (answers) or end (everything). */
export function startSuggestions(): void {
  onReturned(returned);
  onEvents((panel, events) => {
    // It reported something: whatever was sent to it without a sign it took it, it has now.
    let took = false;
    for (const s of suggestions.sentTo(panel.id)) if (s.unconfirmed) took = suggestions.setUnconfirmed(s.id, false) || took;
    if (took) changes.emit();
    if (events.some((e) => e.kind === "ended")) expireFor(panel.id, { all: true, error: "The session ended." });
    else if (events.some((e) => e.kind === "start" && e.from)) expireFor(panel.id, { all: true, error: "The panel moved on to another session." });
    else if (events.some(movesOnFrom(cardOf(panel)))) expireFor(panel.id);
  });
  onPanelForgotten((panelId) => expireFor(panelId, { all: true, error: "The panel was closed." }));
}
