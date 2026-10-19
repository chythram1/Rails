// Delivery (ADR 0010): text the user sends into a session, as their next message, through the agent's own
// way in (spike-verified, docs/providers.md). Each one starts a turn on an idle session, shown in its terminal;
// Rails never types into a panel. A busy session (working, or waiting on a dialog) gets a message in its own
// queue, for after its current turn: Claude Code's message socket and Codex's queue do that by themselves, the
// pi extension uses pi's follow-up queue. Only messages may wait (`queue`); an answer must not outlive its question.
// - Claude Code: its message socket (reported at SessionStart): one JSON line {"type":"user","message":…}.
//   Claude Code presents what arrives there as a message from another Claude session ("not typed by your
//   user"), so a reply starts with a line that says whose it is (CLAUDE_ATTRIBUTION).
// - pi: the Rails extension long-polls GET /bridge/<panel>/pi/inbox, hands what arrives to
//   pi.sendUserMessage if pi is idle, and says whether it did (POST /bridge/<panel>/pi/delivered).
// - Codex: thread/queue/add on its daemon (codex.ts).
import { randomUUID } from "node:crypto";
import net from "node:net";
import type { Panel } from "@rails/shared";
import type { SessionCard } from "./board.ts";
import { sendToCodex } from "./codex.ts";

/** How long a session's way in has to take a message. */
const TAKE_MS = 3000;
/** How long the pi extension has to say pi took a message. */
const ACK_MS = 5000;
/** How long a pi poll waits for a message before it's answered empty (the extension then polls again). */
export const POLL_MS = 25_000;

/** What a reply to Claude Code starts with. pi and Codex show replies as the user's own messages, so they get none. */
export const CLAUDE_ATTRIBUTION = "From your user, sent with Rails:";

const unreachable = (agent: string) => `Rails can't reach this ${agent} session (it may have started before Rails could see it). Reply in its panel.`;

/** Send text into a session. `queued`: it was busy, so the text waits in its queue. */
export async function deliver(panel: Panel, card: SessionCard, text: string, { queue = false } = {}): Promise<{ queued: boolean }> {
  const busy = card.status === "working" || card.status === "waiting";
  switch (panel.kind) {
    case "claude":
      if (!card.inbox) throw new Error(unreachable("Claude Code"));
      await writeLine(card.inbox, JSON.stringify({ type: "user", message: { role: "user", content: `${CLAUDE_ATTRIBUTION}\n${text}` } }));
      return { queued: busy };
    case "pi":
      return piInbox.hand(panel.id, text, { queue });
    case "codex": {
      const thread = panel.sessionId ?? card.sessionId;
      if (!thread) throw new Error(unreachable("Codex"));
      await sendToCodex(thread, text);
      return { queued: busy };
    }
    default:
      throw new Error("Shells don't take replies.");
  }
}

/** Write one line to a Unix socket; done once it's flushed (Claude Code doesn't answer). */
function writeLine(path: string, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Claude Code didn't take the message in time. Reply in its panel."));
    }, TAKE_MS);
    socket.on("error", () => {
      clearTimeout(timer);
      reject(new Error(unreachable("Claude Code")));
    });
    socket.on("connect", () =>
      socket.end(line + "\n", () => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

/** A message for a pi session, as its extension receives it. `queue`: it may wait in pi's follow-up queue. */
export interface PiMessage {
  id: string;
  text: string;
  queue: boolean;
}

/**
 * Messages for pi sessions, handed to the Rails extension's long poll (one per panel). The extension gives a
 * message to pi if pi is idle, or into pi's follow-up queue if it may wait, and says which (`ack`): it counts
 * as sent only then, so one lost on the way (the poll's connection dropped), or an answer that arrived as pi
 * started working, isn't marked sent.
 */
export class PiInbox {
  private waiting = new Map<string, (messages: PiMessage[]) => void>();
  private acks = new Map<string, { panelId: string; settle: (result: { error?: string; queued?: boolean }) => void }>();

  /** The extension asks for messages: answered with one as soon as it's sent, or empty after `holdMs`. */
  poll(panelId: string, signal: AbortSignal, holdMs = POLL_MS): Promise<PiMessage[]> {
    this.waiting.get(panelId)?.([]); // a newer poll takes over
    return new Promise((resolve) => {
      const done = (messages: PiMessage[]) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (this.waiting.get(panelId) === done) this.waiting.delete(panelId);
        resolve(messages);
      };
      const stop = () => done([]);
      const timer = setTimeout(stop, holdMs);
      signal.addEventListener("abort", stop);
      this.waiting.set(panelId, done);
    });
  }

  /**
   * Hand text to the panel's extension and wait until it says pi took it. It gets `takeMs` to come back if
   * it's between two polls, then `ackMs` to answer.
   */
  async hand(panelId: string, text: string, { queue = false, takeMs = TAKE_MS, ackMs = ACK_MS } = {}): Promise<{ queued: boolean }> {
    const until = Date.now() + takeMs;
    while (!this.waiting.has(panelId)) {
      if (Date.now() >= until) throw new Error(unreachable("pi"));
      await new Promise((r) => setTimeout(r, 100));
    }
    const id = randomUUID();
    const answered = new Promise<{ queued: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => settle({ error: "pi didn't confirm it got the message. Check its panel before sending again." }), ackMs);
      const settle = ({ error, queued = false }: { error?: string; queued?: boolean }) => {
        clearTimeout(timer);
        this.acks.delete(id);
        if (error) reject(new Error(error));
        else resolve({ queued });
      };
      this.acks.set(id, { panelId, settle });
    });
    this.waiting.get(panelId)!([{ id, text, queue }]);
    return answered;
  }

  /** The extension's answer for a message: pi took it (now, or into its queue), or it was busy (or the message was bad). */
  ack(panelId: string, id: unknown, ok: unknown, queued?: unknown): void {
    const pending = typeof id === "string" ? this.acks.get(id) : undefined;
    if (!pending || pending.panelId !== panelId) return; // not this panel's message
    pending.settle(ok === true ? { queued: queued === true } : { error: "pi started working on something else, so it wasn't sent." });
  }
}

export const piInbox = new PiInbox();
