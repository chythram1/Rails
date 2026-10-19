// Codex reports through its own app-server daemon (ADR 0007, docs/providers.md): interactive `codex`
// sessions run their threads on a shared local daemon, and any client of it hears about them. Rails is one
// such client, connected only while Codex panels are open:
// - every client gets `thread/started` and `thread/status/changed`, which map a new Codex panel to its
//   thread (Codex picks the id) and say when a thread waits for approval or input;
// - `thread/resume {excludeTurns}` subscribes Rails to a mapped thread's turns and items.
// The protocol is JSON-RPC over a WebSocket on the daemon's Unix socket. It's marked experimental, so
// unknown messages are ignored and a lost connection is retried.
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import type { Panel } from "@rails/shared";
import { CODEX_HOME } from "../config.ts";
import { panels } from "../db.ts";
import { fromCodex } from "./events.ts";
import { noteShell, record } from "./index.ts";

const SOCKET = join(CODEX_HOME, "app-server-control", "app-server-control.sock");
/** A new panel's thread starts within this long, or the panel stays unmapped. */
const MAP_WITHIN_MS = 2 * 60_000;

type Send = (msg: object) => void;

/** New Codex panels waiting for their thread, oldest first. */
interface Pending {
  panelId: string;
  cwd: string;
  since: number;
}

/**
 * The part that understands the daemon's messages, apart from the connection, so it can be tested with
 * fake messages. `assign` records a panel's session id (and tells browsers).
 */
export class CodexWatcher {
  private pending: Pending[] = [];
  private subscribed = new Set<string>();
  private nextId = 1;
  private replies = new Map<number, (result: any, error?: unknown) => void>();

  constructor(
    private send: Send,
    private assign: (panelId: string, threadId: string) => void,
  ) {}

  /** A Codex panel started: map it to the next thread that starts in its folder. */
  expect(panelId: string, cwd: string) {
    this.pending.push({ panelId, cwd: real(cwd), since: Date.now() });
  }

  /** The connection is (re)established: introduce ourselves and resubscribe to mapped threads. */
  hello(mapped: string[]) {
    this.subscribed.clear();
    this.request("initialize", { clientInfo: { name: "rails", version: "0" }, capabilities: { experimentalApi: true } });
    this.send({ jsonrpc: "2.0", method: "initialized" });
    for (const threadId of mapped) this.subscribe(threadId);
    // Threads that started before Rails connected (the first codex starts the daemon): look them up.
    if (this.pending.length)
      this.request("thread/loaded/list", {}, (r) => {
        for (const id of r?.data ?? []) if (!panels.bySession(id)) this.request("thread/read", { threadId: id }, (t) => this.started(t?.thread));
      });
  }

  handle(msg: any) {
    if (msg?.id !== undefined && msg.method === undefined) {
      this.replies.get(msg.id)?.(msg.result, msg.error);
      this.replies.delete(msg.id);
      return;
    }
    if (typeof msg?.method !== "string") return;
    const params = msg.params ?? {};
    if (msg.method === "thread/started") return this.started(params.thread);
    const threadId: string | undefined = params.threadId ?? params.thread?.id;
    if (!threadId) return;
    const panel = panels.bySession(threadId);
    if (!panel || panel.kind !== "codex") return; // the user's own Codex sessions outside Rails
    if (!this.subscribed.has(threadId)) this.subscribe(threadId);
    noteShell(panel.id, "codex", msg.method, params);
    record(panel.id, fromCodex(msg.method, params), threadId);
  }

  private started(thread: any) {
    if (!thread?.id || thread.ephemeral || thread.parentThreadId) return;
    const known = panels.bySession(thread.id);
    if (known) return this.subscribe(thread.id); // a resumed session
    this.pending = this.pending.filter((p) => Date.now() - p.since < MAP_WITHIN_MS && panels.get(p.panelId));
    const cwd = typeof thread.cwd === "string" ? real(thread.cwd) : undefined;
    // Only threads started after the panel: the user may have their own Codex session in the same folder.
    const created = typeof thread.createdAt === "number" ? thread.createdAt * 1000 : Date.now();
    const i = this.pending.findIndex((p) => p.cwd === cwd && created >= p.since - 5000);
    if (i < 0) return;
    const [p] = this.pending.splice(i, 1);
    this.assign(p.panelId, thread.id);
    this.subscribe(thread.id);
    record(p.panelId, [{ kind: "start", sessionId: thread.id }], thread.id);
  }

  /**
   * Subscribe to a thread's turns and items. A brand-new thread can't be resumed until Codex has saved its
   * first turn ("no rollout found"), so a failed attempt is forgotten and retried on the thread's next
   * status change, which every client hears.
   */
  private subscribe(threadId: string) {
    if (this.subscribed.has(threadId)) return;
    this.subscribed.add(threadId);
    this.request("thread/resume", { threadId, excludeTurns: true }, (_r, error) => {
      if (error) this.subscribed.delete(threadId);
    });
  }

  private request(method: string, params: object, onReply?: (result: any, error?: unknown) => void) {
    const id = this.nextId++;
    if (onReply) this.replies.set(id, onReply);
    this.send({ jsonrpc: "2.0", id, method, params });
  }

  /** Send text to a thread as the user's next message (ADR 0010): on an idle thread it starts a turn. */
  queue(threadId: string, text: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex didn't take the message in time. Reply in its panel.")), timeoutMs);
      const input = [{ type: "text", text }];
      this.request("thread/queue/add", { threadId, clientUserMessageId: randomUUID(), input }, (_result, error) => {
        clearTimeout(timer);
        if (error) reject(new Error(`Codex refused the message: ${(error as { message?: string })?.message ?? "unknown error"}`));
        else resolve();
      });
    });
  }

  /** Whether a new panel still waits for its thread (closed panels and old entries don't count). */
  hasPending = () => this.pending.some((p) => Date.now() - p.since < MAP_WITHIN_MS && panels.get(p.panelId));
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// ---- the connection: only while Codex panels are open ----

let ws: WebSocket | undefined;
let watcher: CodexWatcher | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let assignSession: (panelId: string, threadId: string) => void = () => {};

/** Set by panels.ts: store a Codex panel's thread id as its session id and tell browsers. */
export const onCodexSession = (fn: (panelId: string, threadId: string) => void) => void (assignSession = fn);

const codexPanels = (all: Panel[]) => all.filter((p) => p.kind === "codex");

/** Watch Codex panels: call when one starts (with its folder) and once at startup. */
export function watchCodex(open: Panel[], started?: { panelId: string; cwd: string }) {
  if (!codexPanels(open).length && !started) return;
  watcher ??= new CodexWatcher(
    (m) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
    (panelId, threadId) => assignSession(panelId, threadId),
  );
  if (started) watcher.expect(started.panelId, started.cwd);
  connect(() => codexPanels(open).flatMap((p) => (p.sessionId ? [p.sessionId] : [])));
}

/** Send text into a Codex panel's thread (bridge/deliver.ts). */
export function sendToCodex(threadId: string, text: string): Promise<void> {
  if (!watcher || ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Rails isn't connected to Codex right now. Reply in its panel."));
  return watcher.queue(threadId, text);
}

/** A panel closed: drop the connection when no Codex panel (or new one waiting for its thread) is left. */
export function unwatchCodexIfIdle() {
  if (watcher?.hasPending() || panels.all().some((p) => p.kind === "codex")) return;
  clearTimeout(retry);
  retry = undefined;
  const socket = ws;
  ws = undefined;
  socket?.close(); // its close handler finds nothing to watch, so it doesn't reconnect
}

function connect(mapped: () => string[]) {
  if (ws || retry) return;
  const socket = new WebSocket(`ws+unix://${SOCKET}:/`);
  ws = socket;
  socket.on("open", () => watcher?.hello(mapped()));
  socket.on("message", (data) => {
    try {
      watcher?.handle(JSON.parse(String(data)));
    } catch {
      // a message we don't understand
    }
  });
  socket.on("error", () => {}); // the daemon isn't running yet (the first codex starts it): retried on close
  socket.on("close", () => {
    ws = undefined;
    const stillNeeded = watcher?.hasPending() || panels.all().some((p) => p.kind === "codex");
    if (stillNeeded) retry = setTimeout(() => ((retry = undefined), connect(() => panels.all().flatMap((p) => (p.kind === "codex" && p.sessionId ? [p.sessionId] : [])))), 2000);
  });
}
