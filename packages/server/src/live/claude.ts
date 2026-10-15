import { randomUUID } from "node:crypto";
import { query, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { LiveStatus, Message, PermissionMode, PermissionRequest } from "@rails/shared";
import { normalizeClaude } from "../providers/claude.ts";

export interface LiveEvents {
  message(m: Message): void;
  status(s: LiveStatus, error?: string): void;
  mode(m: PermissionMode): void;
  permissionRequest(r: PermissionRequest): void;
  permissionResolved(id: string, allow: boolean): void;
  ended(): void;
}

/** Minimal async queue feeding the SDK's streaming-input prompt. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter?: (r: IteratorResult<SDKUserMessage>) => void;
  private closed = false;
  push(m: SDKUserMessage) {
    if (this.waiter) {
      this.waiter({ value: m, done: false });
      this.waiter = undefined;
    } else this.items.push(m);
  }
  close() {
    this.closed = true;
    this.waiter?.({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const m = this.items.shift();
        if (m) return Promise.resolve({ value: m, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => (this.waiter = r));
      },
    };
  }
}

/**
 * A live Claude Code session owned by the server (Claude Agent SDK, streaming input mode).
 * Either starts a new session with a pre-chosen id, or resumes an existing one.
 */
export class ClaudeLive {
  status: LiveStatus = "starting";
  readonly buffer: Message[] = [];
  readonly pending = new Map<string, { req: PermissionRequest; resolve: (allow: boolean) => void }>();
  private input = new InputQueue();
  private abort = new AbortController();
  private q: Query;
  private seen = new Set<string>();

  constructor(
    readonly sessionId: string,
    readonly cwd: string,
    public mode: PermissionMode,
    resume: boolean,
    private ev: LiveEvents,
  ) {
    this.q = query({
      prompt: this.input,
      options: {
        cwd,
        ...(resume ? { resume: sessionId } : { sessionId }),
        permissionMode: mode,
        abortController: this.abort,
        pathToClaudeCodeExecutable: process.env.CLAUDE_PATH || undefined,
        settingSources: ["user", "project", "local"],
        canUseTool: (toolName, input, { signal }) =>
          new Promise((resolve) => {
            const req: PermissionRequest = { id: randomUUID(), toolName, input, createdAt: new Date().toISOString() };
            const done = (allow: boolean) => {
              if (!this.pending.delete(req.id)) return;
              this.ev.permissionResolved(req.id, allow);
              resolve(allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Denied by user in rails" });
            };
            this.pending.set(req.id, { req, resolve: done });
            signal.addEventListener("abort", () => done(false));
            this.ev.permissionRequest(req);
          }),
      },
    });
    void this.pump();
  }

  private emit(m: Message) {
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id);
    this.buffer.push(m);
    this.ev.message(m);
  }

  private setStatus(s: LiveStatus, error?: string) {
    this.status = s;
    this.ev.status(s, error);
  }

  private async pump() {
    try {
      for await (const msg of this.q) {
        if (msg.type === "assistant" || msg.type === "user") normalizeClaude(msg).forEach((m) => this.emit(m));
        else if (msg.type === "result") {
          if (msg.subtype !== "success")
            this.emit({ kind: "system", id: msg.uuid, text: `Run ended: ${msg.subtype}` });
          this.setStatus("idle");
        }
      }
      this.setStatus("stopped");
    } catch (e: any) {
      if (this.abort.signal.aborted) this.setStatus("stopped");
      else {
        this.emit({ kind: "system", id: randomUUID(), text: `Agent error: ${e?.message ?? e}` });
        this.setStatus("error", String(e?.message ?? e));
      }
    } finally {
      for (const p of this.pending.values()) p.resolve(false);
      this.ev.ended();
    }
  }

  send(text: string) {
    const uuid = randomUUID();
    this.emit({ kind: "user", id: uuid, text, ts: new Date().toISOString() });
    this.input.push({
      type: "user",
      uuid,
      session_id: this.sessionId,
      parent_tool_use_id: null,
      origin: { kind: "human" },
      message: { role: "user", content: text },
    } as SDKUserMessage);
    this.setStatus("running");
  }

  answer(requestId: string, allow: boolean) {
    this.pending.get(requestId)?.resolve(allow);
  }

  async setMode(mode: PermissionMode) {
    await this.q.setPermissionMode(mode);
    this.mode = mode;
    this.ev.mode(mode);
  }

  async interrupt() {
    await this.q.interrupt();
  }

  stop() {
    this.input.close();
    this.abort.abort();
  }
}
