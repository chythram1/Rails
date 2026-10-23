// Codex reports through its own app-server daemon (ADR 0007, docs/providers.md): interactive `codex`
// sessions run their threads on a shared local daemon, and any client of it hears about them. Rails is one
// such client, connected only while Codex panels are open:
// - every client gets `thread/started` and `thread/status/changed`, which map a new Codex panel to its
//   thread (Codex picks the id) and say when a thread waits for approval or input;
// - `thread/resume {excludeTurns}` subscribes Rails to a mapped thread's turns and items;
// - a panel's Codex can move to another thread (`/new`, `/fork`, `/resume`), and the daemon doesn't say which client
//   did it, so Rails follows a fork by its `forkedFromId` and a new or resumed thread when only one Codex panel is
//   open in its folder (`follow`; docs/providers.md);
// - Rails starts a new panel's thread itself, with its agent tools as dynamic tools (ADR 0030, `startThread`), and
//   answers their calls (`item/tool/call`), which the daemon sends every client of the thread.
// The protocol is JSON-RPC over a WebSocket on the daemon's Unix socket. It's marked experimental, so
// unknown messages are ignored and a lost connection is retried.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import WebSocket from "ws";
import type { Panel } from "@rails/shared";
import { CODEX_HOME } from "../config.ts";
import { panels, projects } from "../db.ts";
import { fromCodex } from "./events.ts";
import { cardOf, noteShell, record } from "./index.ts";

const SOCKET = join(CODEX_HOME, "app-server-control", "app-server-control.sock");
/** A new panel's thread starts within this long, or the panel stays unmapped. */
const MAP_WITHIN_MS = 2 * 60_000;

type Send = (msg: object) => void;

/** Rails' agent tools for Codex (ADR 0030), set by agentTools.ts: their specs, and what answers a call. */
export interface CodexTools {
  spec: object[];
  call(panelId: string, tool: string, args: unknown, signal: AbortSignal): Promise<{ text: string; isError: boolean }>;
}
let tools: CodexTools | undefined;
export const setCodexTools = (t: CodexTools) => void (tools = t);
/** The namespace of Rails' tools: the TUI answers only calls in its own (`codex_tui`), and leaves ours to us. */
const NAMESPACE = "rails";
/** How long a finished call's answer is kept, for the daemon sending the call again after Rails reconnects. */
const ANSWER_KEPT_MS = 10 * 60_000;

/**
 * When a thread started. Codex's thread ids are UUIDv7s, whose first 48 bits are that time in ms; `createdAt` isn't
 * reliable: a thread that hasn't saved a turn reports the time it was read.
 */
export function threadStarted(thread: { id?: unknown; createdAt?: unknown }): number {
  const hex = typeof thread.id === "string" ? thread.id.replace(/-/g, "") : "";
  if (/^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(hex)) return parseInt(hex.slice(0, 12), 16);
  return typeof thread.createdAt === "number" ? thread.createdAt * 1000 : Date.now();
}

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
  /** Panels whose thread hasn't had a turn yet: a newer thread in their folder replaces it (see `started`). */
  private unused = new Map<string, { threadId: string; cwd: string; started: number; at: number }>();
  private subscribed = new Set<string>();
  /** Threads the daemon reported unloaded: one that loads again was resumed by some client (`/resume`). */
  private unloaded = new Set<string>();
  /** Threads a panel moved away from, and that panel: going back to one is that panel's `/resume`. */
  private left = new Map<string, string>();
  private nextId = 1;
  private replies = new Map<number, (result: any, error?: unknown) => void>();
  /** Threads Rails started for new panels: not some other panel's new thread (`started`). */
  private ours = new Set<string>();
  /**
   * Folders Rails is starting a thread in, and threads that started there meanwhile: the daemon can announce Rails'
   * own before answering `thread/start`, so they wait until it has, and Rails knows which one is its own.
   */
  private launches = new Map<string, number>();
  private held: { thread: any; live: boolean }[] = [];
  /**
   * Tool calls by Codex's call id: the request to answer (the daemon sends a pending call again to a client that
   * subscribes, with a new request id, so after a reconnect the newest one), the turn, and its answer once done.
   */
  private calls = new Map<string, { requestId: unknown; threadId: string; turnId: string; abort: AbortController; answer?: object; at?: number }>();

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
        for (const id of r?.data ?? []) if (!panels.bySession(id)) this.request("thread/read", { threadId: id }, (t) => this.started(t?.thread, false));
      });
  }

  /**
   * The connection closed: requests waiting for an answer get none, so they fail now (a thread Rails was starting
   * would otherwise hold its folder's new threads until the server restarts).
   */
  disconnected() {
    const waiting = [...this.replies.values()];
    this.replies.clear();
    for (const reply of waiting) reply(undefined, { message: "the connection to Codex closed" });
  }

  handle(msg: any) {
    if (msg?.id !== undefined && msg.method === undefined) {
      this.replies.get(msg.id)?.(msg.result, msg.error);
      this.replies.delete(msg.id);
      return;
    }
    if (typeof msg?.method !== "string") return;
    const params = msg.params ?? {};
    if (msg.method === "item/tool/call" && msg.id !== undefined) return this.toolCall(msg.id, params);
    if (msg.method === "thread/started") return this.started(params.thread);
    if (msg.method === "turn/completed" && typeof params.threadId === "string") this.turnOver(params.threadId, params.turn?.id);
    const threadId: string | undefined = params.threadId ?? params.thread?.id;
    if (!threadId) return;
    const panel = panels.bySession(threadId);
    if (!panel || panel.kind !== "codex") return this.elsewhere(msg.method, threadId, params.status?.type); // not a panel's (yet)
    const turn = msg.method.startsWith("turn/") || msg.method.startsWith("item/") || params.status?.type === "active";
    if (turn && this.unused.get(panel.id)?.threadId === threadId) this.unused.delete(panel.id);
    if (!this.subscribed.has(threadId)) this.subscribe(threadId);
    noteShell(panel.id, "codex", msg.method, params);
    record(panel.id, fromCodex(msg.method, params), threadId);
  }

  /** A thread started, or (`live` false) one found loaded when Rails connected. */
  private started(thread: any, live = true) {
    if (!thread?.id || thread.ephemeral || thread.parentThreadId || this.ours.has(thread.id)) return;
    const known = panels.bySession(thread.id);
    if (known) return this.subscribe(thread.id); // a resumed session
    this.pending = this.pending.filter((p) => Date.now() - p.since < MAP_WITHIN_MS && panels.get(p.panelId));
    const cwd = typeof thread.cwd === "string" ? real(thread.cwd) : undefined;
    if (!cwd) return;
    if (this.launches.get(cwd)) return void this.held.push({ thread, live });
    // Only threads started after the panel: the user may have their own Codex session in the same folder.
    const started = threadStarted(thread);
    const i = this.pending.findIndex((p) => p.cwd === cwd && started >= p.since - 5000);
    if (i >= 0) return this.link(this.pending.splice(i, 1)[0].panelId, cwd, thread.id, started);
    // Codex can start a thread it never uses: in a folder it hasn't trusted yet, one at launch and the real one after
    // the trust prompt. A panel whose thread hasn't had a turn moves to a newer one in its folder.
    for (const [panelId, u] of this.unused)
      if (u.cwd === cwd && started > u.started && Date.now() - u.at < MAP_WITHIN_MS && panels.get(panelId)) return this.link(panelId, cwd, thread.id, started);
    if (!live) return;
    // `/fork` in a panel: the fork names the thread it came from.
    const from = typeof thread.forkedFromId === "string" ? panels.bySession(thread.forkedFromId) : undefined;
    if (from?.kind === "codex") return this.moveTo(from.id, thread.id);
    // `/new` in a panel: a newer thread in its folder, from the terminal app, while it's idle.
    this.follow(thread, cwd, (p) => started > threadStarted({ id: p.sessionId }));
  }

  /** A thread no panel follows reported something: if a client loaded it again, it may be a panel's `/resume`. */
  private elsewhere(method: string, threadId: string, status: string | undefined) {
    if (method !== "thread/status/changed" || !status) return;
    if (status === "notLoaded") return void this.unloaded.add(threadId);
    if (status !== "idle" && status !== "active") return;
    // Loaded again after the daemon unloaded it, or a turn in a thread a panel left: a client went (back) to it.
    const leftBy = this.left.get(threadId);
    if (!this.unloaded.delete(threadId) && !(leftBy && status === "active")) return;
    this.request("thread/read", { threadId }, (r) => {
      const thread = r?.thread;
      if (!thread?.id || thread.ephemeral || thread.parentThreadId || panels.bySession(thread.id) || typeof thread.cwd !== "string") return;
      // Back to a thread the panel left is that panel's own `/resume`; otherwise, the one-panel rule.
      const back = leftBy ? panels.get(leftBy) : undefined;
      if (back?.kind === "codex" && !busy(back)) return this.moveTo(back.id, thread.id);
      this.follow(thread, real(thread.cwd));
    });
  }

  /**
   * Move the only Codex panel open in a thread's folder to it, when it's from Codex's terminal app and the panel is
   * idle (Codex takes `/new` and `/resume` only between turns). With two panels there, or the user's own Codex in the
   * folder, Rails can't tell whose it is: with two it doesn't guess; the user's own is the known risk (ADR 0007).
   */
  private follow(thread: any, cwd: string, also: (p: Panel) => boolean = () => true) {
    if (thread.source !== "vscode" && thread.source !== "cli") return; // `codex exec`, other apps
    const here = panels.all().filter((p) => p.kind === "codex" && p.sessionId && real(projects.get(p.projectId)?.path ?? "") === cwd);
    if (here.length === 1 && !busy(here[0]) && also(here[0])) this.moveTo(here[0].id, thread.id);
  }

  /** A panel's Codex moved to another thread: follow it there, and say so (its card, drafts and handoffs go by it). */
  private moveTo(panelId: string, threadId: string) {
    const old = panels.get(panelId)?.sessionId;
    if (!old || old === threadId || panels.bySession(threadId)) return;
    this.unused.delete(panelId);
    this.assign(panelId, threadId);
    if (panels.get(panelId)?.sessionId !== threadId) return;
    this.left.set(old, panelId);
    this.left.delete(threadId);
    this.subscribed.delete(old);
    this.request("thread/unsubscribe", { threadId: old });
    this.subscribe(threadId);
    record(panelId, [{ kind: "start", sessionId: threadId, from: old }], threadId);
  }

  private link(panelId: string, cwd: string, threadId: string, started: number) {
    this.unused.set(panelId, { threadId, cwd, started, at: Date.now() });
    this.assign(panelId, threadId);
    this.subscribe(threadId);
    record(panelId, [{ kind: "start", sessionId: threadId }], threadId);
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

  /**
   * Answer a question Codex asked while its turn goes on (ADR 0027): steer that turn with the text, as its panel's
   * "answer" does. Without a turn (it ended since), the text goes as the next message instead.
   */
  steer(threadId: string, turnId: string | undefined, text: string, timeoutMs = 5000): Promise<void> {
    if (!turnId) return this.queue(threadId, text, timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Codex didn't take the answer in time. Answer it in its panel.")), timeoutMs);
      const input = [{ type: "text", text }];
      this.request("turn/steer", { threadId, expectedTurnId: turnId, clientUserMessageId: randomUUID(), input }, (_result, error) => {
        clearTimeout(timer);
        if (error) reject(new Error(`Codex refused the answer: ${(error as { message?: string })?.message ?? "unknown error"}`));
        else resolve();
      });
    });
  }

  /**
   * Start a thread for a new panel, with Rails' tools (ADR 0030); the panel then runs `codex resume <id>`. Codex
   * keeps dynamic tools with the thread, so they're there after a resume or a fork, but only a thread's start can
   * set them. The TUI can't resume a thread that hasn't saved anything, and Codex saves a thread at its first turn,
   * or when it's placed in the sidebar's sections: placing it in none, where it is anyway, saves it now.
   *
   * Only in a folder Codex trusts (`roots`: the folder, its git root, its main repository): a thread keeps the
   * permissions it started with, and in a folder not yet trusted those are read-only, where the TUI would ask for
   * trust first and start its thread after. There Rails throws, and the panel runs plain `codex`.
   */
  async startThread(cwd: string, roots: string[] = [cwd]): Promise<string> {
    if (!tools) throw new Error("No tools for Codex.");
    cwd = real(cwd);
    const config = await this.call("config/read", { cwd });
    const projects = config?.config?.projects ?? {};
    if (!roots.some((r) => projects[r]?.trust_level === "trusted")) throw new Error("Codex doesn't trust this folder yet.");
    this.launches.set(cwd, (this.launches.get(cwd) ?? 0) + 1);
    try {
      const r = await this.call("thread/start", { cwd, dynamicTools: tools.spec });
      const threadId = r?.thread?.id;
      if (typeof threadId !== "string") throw new Error("Codex started no thread.");
      this.ours.add(threadId);
      this.subscribed.add(threadId); // starting it subscribed us
      await this.call("thread/section/move", { threadId, sectionId: null });
      return threadId;
    } finally {
      const left = (this.launches.get(cwd) ?? 1) - 1;
      if (left) this.launches.set(cwd, left);
      else {
        this.launches.delete(cwd);
        const held = this.held.filter((h) => real(h.thread.cwd) === cwd);
        this.held = this.held.filter((h) => !held.includes(h));
        for (const h of held) this.started(h.thread, h.live);
      }
    }
  }

  /** A call to one of Rails' tools: answer it for the panel the thread is in. Calls in other namespaces aren't ours. */
  private toolCall(requestId: unknown, params: any) {
    if (params.namespace !== NAMESPACE || typeof params.callId !== "string" || typeof params.threadId !== "string") return;
    const now = Date.now();
    for (const [id, c] of this.calls) if (c.at && now - c.at > ANSWER_KEPT_MS) this.calls.delete(id);
    const known = this.calls.get(params.callId);
    if (known) {
      known.requestId = requestId; // sent again after a reconnect: answer this one
      if (known.answer) this.send({ jsonrpc: "2.0", id: requestId, result: known.answer });
      return;
    }
    const call = { requestId, threadId: params.threadId, turnId: String(params.turnId ?? ""), abort: new AbortController() } as NonNullable<ReturnType<typeof this.calls.get>>;
    this.calls.set(params.callId, call);
    const panel = panels.bySession(params.threadId);
    const run =
      panel?.kind === "codex" && tools
        ? tools.call(panel.id, String(params.tool), params.arguments ?? {}, call.abort.signal)
        : Promise.resolve({ text: "This session isn't in a Rails panel any more, so Rails' tools can't reach its project.", isError: true });
    run
      .catch((e: any) => ({ text: String(e?.message ?? e), isError: true }))
      .then(({ text, isError }) => {
        call.answer = { contentItems: [{ type: "inputText", text }], success: !isError };
        call.at = Date.now();
        if (!call.abort.signal.aborted) this.send({ jsonrpc: "2.0", id: call.requestId, result: call.answer });
      });
  }

  /** A turn ended (or was interrupted, the only word Codex gives of it): its calls still running are moot. */
  private turnOver(threadId: string, turnId: unknown) {
    for (const c of this.calls.values()) if (!c.answer && c.threadId === threadId && (!turnId || c.turnId === turnId)) c.abort.abort();
  }

  private call(method: string, params: object): Promise<any> {
    return new Promise((resolve, reject) =>
      this.request(method, params, (result, error) => (error ? reject(new Error(`Codex refused ${method}: ${(error as { message?: string })?.message ?? "unknown error"}`)) : resolve(result))),
    );
  }

  /** Whether a new panel still waits for its thread (closed panels and old entries don't count). */
  hasPending = () => this.pending.some((p) => Date.now() - p.since < MAP_WITHIN_MS && panels.get(p.panelId));
}

/** A panel's session is mid-turn: its Codex can't be switching threads. */
const busy = (p: Panel) => ["working", "waiting"].includes(cardOf(p).status);

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
export function watchCodex(open: Panel[], started?: { panelId: string; cwd: string }, launch = false) {
  if (!codexPanels(open).length && !started && !launch) return;
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

/** Answer a Codex question by steering its turn (ADR 0027), or as the next message once the turn is over. */
export function steerCodex(threadId: string, turnId: string | undefined, text: string): Promise<void> {
  if (!watcher || ws?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Rails isn't connected to Codex right now. Answer it in its panel."));
  return watcher.steer(threadId, turnId, text);
}

/** New panels whose thread Rails is starting: the connection stays up for them. */
let launching = 0;
/** How long a new panel waits for Rails to start its thread before it runs plain `codex`, without Rails' tools. */
const START_WITHIN_MS = 10_000;

/**
 * Start a new panel's thread with Rails' tools (ADR 0030): its id, for `codex resume <id>`. Starts Codex's daemon
 * if it isn't running (the first `codex` would). Rejects if Codex doesn't manage within START_WITHIN_MS, and the
 * panel runs plain `codex` instead.
 */
export async function startCodexThread(cwd: string, open: Panel[]): Promise<string> {
  launching++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("Codex didn't start a thread in time.")), START_WITHIN_MS)));
    return await Promise.race([timeout, Promise.all([connected(open), trustRoots(cwd)]).then(([, roots]) => watcher!.startThread(cwd, roots))]);
  } finally {
    clearTimeout(timer);
    launching--;
  }
}

/** The paths Codex looks up a folder's trust by: the folder, its git root, and the main repository of a worktree. */
async function trustRoots(cwd: string): Promise<string[]> {
  const git = (...args: string[]) =>
    new Promise<string>((resolve) => execFile("git", ["-C", cwd, ...args], { timeout: 3000 }, (e, out) => resolve(e ? "" : out.trim())));
  const [top, common] = await Promise.all([git("rev-parse", "--show-toplevel"), git("rev-parse", "--path-format=absolute", "--git-common-dir")]);
  return [...new Set([cwd, top, common && dirname(common)].filter(Boolean).map(real))];
}

/** Connected to the daemon, starting it first if it isn't running. */
async function connected(open: Panel[]): Promise<void> {
  watchCodex(open, undefined, true);
  if (await opened(1500)) return;
  await new Promise<void>((resolve) => execFile("codex", ["app-server", "daemon", "start"], { timeout: 8000 }, () => resolve()));
  clearTimeout(retry);
  retry = undefined;
  connect(() => codexPanels(panels.all()).flatMap((p) => (p.sessionId ? [p.sessionId] : [])));
  if (!(await opened(5000))) throw new Error("Codex's daemon isn't answering.");
}

/** Whether the connection is (or gets) open within `ms`. */
function opened(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => (ws?.readyState === WebSocket.OPEN ? resolve(true) : Date.now() - started > ms ? resolve(false) : setTimeout(check, 50));
    check();
  });
}

/** A panel closed: drop the connection when no Codex panel (or new one waiting for its thread) is left. */
export function unwatchCodexIfIdle() {
  if (launching || watcher?.hasPending() || panels.all().some((p) => p.kind === "codex")) return;
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
    watcher?.disconnected();
    const stillNeeded = launching || watcher?.hasPending() || panels.all().some((p) => p.kind === "codex");
    if (stillNeeded) retry = setTimeout(() => ((retry = undefined), connect(() => panels.all().flatMap((p) => (p.kind === "codex" && p.sessionId ? [p.sessionId] : [])))), 2000);
  });
}
