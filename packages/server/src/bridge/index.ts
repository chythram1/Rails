// The bridge (ADR 0007): agents in Rails panels report what they do to the server, which keeps it as
// SessionEvents and folds them into the project board. Claude Code reports through hooks and pi through
// a Rails extension, both over HTTP to /bridge/<panelId>/…; Codex through its app-server daemon
// (codex.ts). Each panel gets its own bridge token, which only lets it report about itself: it's not the
// access token, which never reaches panels.
import { randomBytes } from "node:crypto";
import type { AttentionReason, Panel } from "@rails/shared";
import { PORT } from "../config.ts";
import { panels, sessionEvents } from "../db.ts";
import { attentionOf, foldCard, type SessionCard } from "./board.ts";
import { fromClaude, fromPi, shellCall, type SessionEvent, type ShellCall } from "./events.ts";
import { listeners, sameSecret } from "../util.ts";

/** Environment for a panel's process: where to report, and its token. */
export function bridgeEnv(panelId: string): Record<string, string> {
  const token = randomBytes(24).toString("base64url");
  panels.setBridgeToken(panelId, token);
  return { RAILS_BRIDGE: `http://127.0.0.1:${PORT}/bridge/${panelId}`, RAILS_PANEL_TOKEN: token };
}

export const tokenOk = (panelId: string, token: string | undefined) => sameSecret(token, panels.bridgeToken(panelId));

// ---- attention, across all panels ----

const attention = new Map<string, AttentionReason>();
const attentionChanges = listeners<[list: { panelId: string; reason: AttentionReason }[]]>();
/** The panels that need the user changed. */
export const onAttention = attentionChanges.on;
export const attentionList = () => [...attention].map(([panelId, reason]) => ({ panelId, reason }));

function setAttention(panelId: string, reason: AttentionReason | undefined) {
  if (attention.get(panelId) === reason) return;
  if (reason) attention.set(panelId, reason);
  else attention.delete(panelId);
  attentionChanges.emit(attentionList());
}

/** A session's card on the board. */
export function cardOf(panel: Panel): SessionCard {
  return foldCard(panel, sessionEvents.list(panel.id));
}

const recorded = listeners<[panel: Panel, events: SessionEvent[]]>();
/** A panel reported events (after they're stored). Sprocket watches follow sessions through this. */
export const onEvents = recorded.on;

const moves = listeners<[panel: Panel]>();
/** A panel moved on to another session (panels.ts tells browsers). */
export const onSessionMoved = moves.on;

/**
 * Record events from a panel and update what depends on them. A start with another session than the panel's is
 * Claude Code's `/clear` or `/resume`, or pi's `/new`, `/resume` or `/fork`: the panel follows it, as a Codex panel
 * follows its thread (bridge/codex.ts), unless another panel has that session. Its sidebar row, title, drafts and
 * handoffs go by the panel's session.
 */
export function record(panelId: string, events: SessionEvent[], sessionId?: string): void {
  let panel = panels.get(panelId);
  if (!panel || !events.length) return;
  for (const e of events) {
    if (e.kind !== "start" || !e.sessionId || !panel.sessionId || e.sessionId === panel.sessionId || panels.bySession(e.sessionId)) continue;
    e.from ??= panel.sessionId;
    panels.setSession(panel.id, e.sessionId);
    panel = panels.get(panelId)!;
    moves.emit(panel);
  }
  for (const e of events) sessionEvents.add(panelId, sessionId ?? (e.kind === "start" ? e.sessionId : undefined), e);
  setAttention(panelId, attentionOf(cardOf(panel)));
  recorded.emit(panel, events);
}

const returnedTexts = listeners<[panelId: string, text: string]>();
/** pi put a message Rails had queued back in its editor, unsent (the user stopped its run). */
export const onReturned = returnedTexts.on;

const shellCalls = listeners<[panel: Panel, call: ShellCall]>();
/** A session's shell command started or ended (shellEdits.ts finds the files it changed). */
export const onShellCall = shellCalls.on;

/** Pass on a shell command starting or ending, from any agent's report. */
export function noteShell(panelId: string, source: string, name: string, body: unknown): void {
  const call = shellCall(source, name, body);
  const panel = call && panels.get(panelId);
  if (panel) shellCalls.emit(panel, call!);
}

const forgotten = listeners<[panelId: string]>();
/** A panel closed. */
export const onPanelForgotten = forgotten.on;

/** A panel closed: forget what it reported. */
export function forgetPanel(panelId: string): void {
  sessionEvents.removePanel(panelId);
  setAttention(panelId, undefined);
  forgotten.emit(panelId);
}

/** Rebuild attention after a restart, from what's stored. */
export function loadAttention(open: Panel[]): void {
  for (const p of open) {
    const reason = attentionOf(cardOf(p));
    if (reason) attention.set(p.id, reason);
  }
}

/** A report from Claude Code (a hook) or pi (the extension), already checked against the panel's token. */
export function receive(panelId: string, source: string, name: string, body: unknown, extra: { inbox?: string } = {}): void {
  noteShell(panelId, source, name, body);
  const returned = (body as any)?.text;
  if (source === "pi" && name === "returned" && typeof returned === "string") returnedTexts.emit(panelId, returned);
  const events = source === "claude" ? fromClaude(name, body, extra) : source === "pi" ? fromPi(name, body) : [];
  const sessionId = (body as any)?.session_id ?? (body as any)?.sessionId;
  record(panelId, events, typeof sessionId === "string" ? sessionId : undefined);
}
