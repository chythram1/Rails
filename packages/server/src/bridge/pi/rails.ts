// The Rails extension for pi (ADR 0007). Rails loads it with `pi --extension` in panels it starts; it
// reports what the session does to Rails' bridge, using RAILS_BRIDGE and RAILS_PANEL_TOKEN from the
// panel's environment, and long-polls Rails for replies the user sends from a Sprocket's chat (ADR 0010),
// which it hands to pi as the user's next message when pi is idle (and tells Rails whether it did). pi loads this file directly (TypeScript through jiti),
// so it imports nothing: the types are loose on purpose. It never blocks pi: reports that fail are dropped.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function railsBridge(pi: any) {
  const base = process.env.RAILS_BRIDGE;
  const token = process.env.RAILS_PANEL_TOKEN;
  if (!base || !token) return; // not started by Rails
  let cwd = "";
  let sessionId = "";

  const post = (event: string, data: Record<string, unknown>) =>
    void fetch(`${base}/pi/${event}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId, cwd, ...data }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});

  const textOf = (message: any): string =>
    (message?.content ?? []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n");

  // Replies from Rails: one poll at a time, held open by Rails until there's one (or 25 s pass).
  let polling = false;
  let stopped = false;
  const poll = async (ctx: any) => {
    if (polling) return;
    polling = true;
    while (!stopped) {
      try {
        const r = await fetch(`${base}/pi/inbox`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(35_000) });
        if (!r.ok) throw new Error(String(r.status));
        const { messages } = (await r.json()) as { messages?: { id?: string; text?: string; queue?: boolean }[] };
        for (const m of messages ?? []) {
          // An idle session gets it now. A busy one gets a message that may wait (`queue`) after its current
          // run; an answer, which no longer fits once pi has started on something else, is turned down.
          const idle = ctx.isIdle();
          const ok = typeof m?.text === "string" && m.text !== "" && (idle || m.queue === true);
          if (ok && idle) pi.sendUserMessage(m.text);
          else if (ok) pi.sendUserMessage(m.text, { deliverAs: "followUp" });
          post("delivered", { id: m?.id, ok, queued: ok && !idle });
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000)); // Rails is down or restarting
      }
    }
  };

  pi.on("session_start", (_e: any, ctx: any) => {
    sessionId = ctx.sessionManager.getSessionId();
    cwd = ctx.sessionManager.getCwd();
    post("session_start", {});
    void poll(ctx);
  });
  pi.on("before_agent_start", (e: any) => {
    if (e.messageType === "user") post("prompt", { text: e.prompt ?? "" });
  });
  // Tool calls running now whose input could be a question for the user (any tool: pi has no question tool
  // of its own, extensions add them under any name). pi's dialog event doesn't say which tool opened it, so
  // a dialog that opens while one of these runs carries its input, and Rails reads the question from it.
  const asking = new Map<string, unknown>();
  const mayAsk = (input: any) => Array.isArray(input?.questions) || typeof input?.question === "string";

  // A tool is reported when it's called (the session is moving), and an edit again once it worked (ADR 0014):
  // the call comes before another extension's approval and the edit may fail, and only a change that happened
  // counts. The end event doesn't carry the input, so it's kept from the call. These are the server's
  // PI_EDIT_TOOLS (events.ts).
  const EDITS = new Set(["edit", "write"]);
  const editing = new Map<string, { tool: string; input: unknown }>();

  pi.on("tool_call", (e: any) => {
    if (mayAsk(e.input)) asking.set(e.toolCallId, e.input);
    if (e.parentToolCallId) return;
    post("tool", { tool: e.toolName, input: e.input, started: true });
    if (EDITS.has(e.toolName)) editing.set(e.toolCallId, { tool: e.toolName, input: e.input });
  });
  pi.on("tool_execution_end", (e: any) => {
    asking.delete(e.toolCallId);
    const edit = editing.get(e.toolCallId);
    editing.delete(e.toolCallId);
    if (edit && !e.isError) post("tool", edit);
  });
  pi.on("ui_prompt_start", (e: any) => {
    const input = [...asking.values()].at(-1);
    post("ui_prompt_start", { title: e.title ?? "", kind: e.kind, ...(input ? { input } : {}) });
  });
  pi.on("ui_prompt_end", () => post("ui_prompt_end", {}));
  pi.on("agent_end", (e: any) => {
    asking.clear();
    editing.clear();
    const last = [...(e.messages ?? [])].reverse().find((m: any) => m.role === "assistant");
    const failed = last?.stopReason === "error";
    // Escape aborts the run: it stopped, it didn't finish.
    if (last?.stopReason === "aborted") post("agent_end", { aborted: true });
    else post("agent_end", failed ? { error: last?.errorMessage ?? "the turn failed" } : { text: textOf(last) });
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    post("session_shutdown", {});
  });
}
