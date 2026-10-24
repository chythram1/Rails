// Handoffs (ADR 0015): the user asks a project's Coordinator to pass something on once a session finishes
// ("when the auth session is done, tell the UI session to use the new endpoint"). The Coordinator plans it
// (plan_handoff); the watches (watches.ts) wake it each time that session ends a turn without asking the user
// anything, and it checks the work is done and drafts the message for the other session (suggest_message),
// which the user sends. If it isn't done, the Coordinator replies (quiet) and waits for the next turn end.
// A handoff is cancelled when either session ends, moves on to another session in its panel, or its panel closes,
// and expires after HANDOFF_TTL_MS, so a forgotten one doesn't fire days later. Each of those leaves a line in the
// Coordinator's chat.
// Its sessions' titles are kept current: a handoff is often planned before a session has a title of its own.
// (The capabilities use this module, so it doesn't import sprockets.ts, which imports the runs.)
import { HANDOFF_NOTE_MAX, type Panel } from "@rails/shared";
import { cardOf, onEvents, onPanelForgotten } from "./bridge/index.ts";
import { handoffs, panels, sessionEvents, sprocketChats, sprocketMessages, sprockets, type StoredHandoff } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { sessionTitle } from "./titles.ts";
import { listeners } from "./util.ts";

/** How long a handoff waits for its session to finish. */
export const HANDOFF_TTL_MS = 24 * 3600_000;
/** Most pending handoffs per Coordinator. */
export const MAX_HANDOFFS = 10;

const changes = listeners();
/** A handoff was planned, done, cancelled or expired (the hub tells browsers the Sprockets changed). */
export const onHandoffsChanged = changes.on;

type Side = { panel: Panel; title: string };

/** The session a panel shows now (its latest start), if Rails knows it. */
const sessionNow = (panel: Panel) => cardOf(panel).sessionId ?? panel.sessionId;

/** Whether a session has had a turn in its panel (among the events Rails keeps for it). */
const TURN = new Set(["prompt", "tool", "waiting", "turn_end", "stopped", "failed"]);
const hadTurn = (panelId: string, sessionId: string) => sessionEvents.list(panelId).some((r) => r.sessionId === sessionId && TURN.has(r.event?.kind));

/**
 * Keep a panel's pending handoffs on the sessions they were planned for (herdr pins its waits to the agent in a pane
 * the same way): a new session in the panel (`/clear`, resuming another) isn't the one the user meant. A side planned
 * before its session was known takes the first one it shows, and so does a side whose session never had a turn (Codex
 * can start a thread it never uses, bridge/codex.ts); a side whose session was in use and moved on ends the handoff.
 * Returns the handoffs still pending at the panel.
 */
export function followSessions(panel: Panel): StoredHandoff[] {
  const now = sessionNow(panel);
  const still: StoredHandoff[] = [];
  for (const h of handoffs.pendingAt(panel.id)) {
    const which = h.from.panelId === panel.id ? "from" : "to";
    const side = h[which];
    if (now && side.sessionId !== now) {
      if (side.sessionId && hadTurn(panel.id, side.sessionId)) {
        end(h, "cancelled", `\u201c${side.title}\u201d moved on to another session.`);
        continue;
      }
      handoffs.setSession(h.id, which, now);
      side.sessionId = now;
    }
    still.push(h);
  }
  return still;
}

/** A Coordinator plans a handoff from one open session to another. */
export function planHandoff(sprocketId: string, from: Side, to: Side, raw: string): StoredHandoff {
  const note = raw.replace(/\s+/g, " ").trim();
  if (!note) throw new Error("Say what to pass on in `note`.");
  if (note.length > HANDOFF_NOTE_MAX) throw new Error(`The note can be at most ${HANDOFF_NOTE_MAX} characters; this is ${note.length}.`);
  if (from.panel.id === to.panel.id) throw new Error("A handoff goes from one session to another.");
  for (const s of [from, to]) if (cardOf(s.panel).status === "ended") throw new Error(`"${s.title}" has ended.`);
  if (handoffs.pending(sprocketId).length >= MAX_HANDOFFS) throw new Error(`You have ${MAX_HANDOFFS} handoffs waiting, the most there can be. Cancel one first.`);
  const side = ({ panel, title }: Side) => {
    const sessionId = sessionNow(panel);
    return { panelId: panel.id, kind: panel.kind, title, ...(sessionId ? { sessionId } : {}) };
  };
  const h = handoffs.create(sprocketId, { from: side(from), to: side(to), note });
  changes.emit();
  return h;
}

/** A Sprocket's pending handoff by the start of its id. */
export function findHandoff(sprocketId: string, id: string): StoredHandoff {
  const q = id.trim().toLowerCase();
  const found = q ? handoffs.pending(sprocketId).find((h) => h.id.startsWith(q)) : undefined;
  if (!found) throw new Error(`No pending handoff has the id "${id}".`);
  return found;
}

/** End a pending handoff, with a line in its Coordinator's chat when it didn't happen. False if it wasn't pending. */
export function end(h: StoredHandoff, status: "done" | "cancelled" | "expired", why?: string): boolean {
  if (!handoffs.end(h.id, status)) return false;
  // In the project chat, with the handoff's events (ADR 0021).
  const chat = sprocketChats.of(h.sprocketId, "project");
  if (why && chat) sprocketMessages.create(chat.id, "notice", `Handoff from \u201c${h.from.title}\u201d to \u201c${h.to.title}\u201d ${status}: ${why}`);
  changes.emit();
  return true;
}

/** The Coordinator drafted the message a handoff waited for. */
export const completeHandoff = (h: StoredHandoff) => end(h, "done");
/** The Coordinator cancels one of its handoffs (its reply says so). */
export const dropHandoff = (h: StoredHandoff) => end(h, "cancelled");

/**
 * End the handoffs of Sprockets that aren't their project's Coordinator anymore: switched off, replaced, moved or
 * deleted (sprockets.ts calls this after each). The chat says so while the Sprocket is still in that project; a
 * moved one's chat went with the move.
 */
export function settleHandoffs(): void {
  for (const h of handoffs.pending()) {
    const s = sprockets.get(h.sprocketId);
    const from = panels.get(h.from.panelId);
    if (s?.coordinator && from && s.projectId === from.projectId) continue;
    end(h, "cancelled", s && from && s.projectId === from.projectId ? `${s.name} isn't the project's Coordinator anymore.` : undefined);
  }
}

/** The user cancels a handoff (the Sprocket panel's Cancel). */
export function cancelHandoff(id: string): void {
  const h = handoffs.pending().find((x) => x.id === id);
  if (!h || !end(h, "cancelled")) throw new ServiceError("That handoff isn't waiting anymore.", 404);
}

/** Expire handoffs older than HANDOFF_TTL_MS (every minute, from startHandoffs). */
export function expireHandoffs(): void {
  const before = new Date(Date.now() - HANDOFF_TTL_MS).toISOString();
  for (const h of handoffs.pending()) if (h.createdAt < before) end(h, "expired", `\u201c${h.from.title}\u201d didn't finish within a day.`);
}

/** Expire old handoffs, and cancel those whose sessions end or close (the watches wake their Coordinators). */
export function startHandoffs(): void {
  settleHandoffs(); // Sprockets the move to one per project detached (ADR 0016)
  expireHandoffs();
  setInterval(() => {
    try {
      expireHandoffs();
    } catch (e) {
      console.error("handoffs:", e); // the next minute tries again
    }
  }, 60_000).unref?.();
  onEvents((panel, events) => {
    try {
      followSessions(panel);
      // A prompt or a finished turn may give the session a title (its first prompt, Claude Code's own title).
      if (events.some((e) => e.kind === "prompt" || e.kind === "turn_end") && handoffs.pendingAt(panel.id).length)
        void sessionTitle(panel)
          .then((title) => handoffs.retitle(panel.id, title) && changes.emit())
          .catch((err) => console.error("handoffs:", err));
      for (const e of events) {
        if (e.kind !== "ended") continue;
        for (const h of handoffs.pendingAt(panel.id)) {
          const from = h.from.panelId === panel.id;
          end(h, "cancelled", from ? `\u201c${h.from.title}\u201d ended first.` : `\u201c${h.to.title}\u201d ended.`);
        }
      }
    } catch (err) {
      console.error("handoffs:", err);
    }
  });
  onPanelForgotten((id) => {
    for (const h of handoffs.pendingAt(id)) end(h, "cancelled", h.from.panelId === id ? `\u201c${h.from.title}\u201d was closed first.` : `\u201c${h.to.title}\u201d was closed.`);
  });
}

