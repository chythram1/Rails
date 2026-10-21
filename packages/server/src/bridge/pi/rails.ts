// The Rails extension for pi (ADR 0007). Rails loads it with `pi --extension` in panels it starts; it
// reports what the session does to Rails' bridge, using RAILS_BRIDGE and RAILS_PANEL_TOKEN from the
// panel's environment, and long-polls Rails for replies the user sends from a Sprocket's chat (ADR 0010),
// which it hands to pi as the user's next message when pi is idle (and tells Rails whether it did), and connects
// the agent tools' MCP server (ADR 0018). pi loads this file directly (TypeScript through jiti),
// so it imports nothing: the types are loose on purpose. It never blocks pi: reports that fail are dropped.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function railsBridge(pi: any) {
  const base = process.env.RAILS_BRIDGE;
  const token = process.env.RAILS_PANEL_TOKEN;
  if (!base || !token) return; // not started by Rails
  let cwd = "";
  let sessionId = "";

  // The agent tools (ADR 0018), an MCP server the bridge serves; pi connects it when the session starts. `direct`,
  // so the model sees them without searching. Older pi has no registerMcpServer, and a name clash throws: skip then.
  try {
    pi.registerMcpServer?.("rails", {
      url: `${base}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
      exposure: "direct",
      description: "Rails: the other coding sessions in this project",
      // Seconds for one call (pi's default is 60): wait_for waits up to 100 (TOOL_TIMEOUT_MS in wiring.ts).
      timeout: 150,
    });
  } catch {
    // no agent tools
  }

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
  // Messages Rails put in pi's queue during a run. Escape aborts the run and puts them back in the editor, unsent:
  // Rails is told, so it doesn't show them as sent.
  const queued = new Set<string>();
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
          const text = m.text as string;
          if (ok && idle) pi.sendUserMessage(text);
          else if (ok) {
            pi.sendUserMessage(text, { deliverAs: "followUp" });
            queued.add(text);
          }
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
  // A failed response pi retries by itself (a dropped connection, a rate limit) isn't a failed turn: a failure counts
  // only if it's still how the run ended once pi settles, after its retries. A later agent_end clears it.
  let failure: string | undefined;
  pi.on("agent_settled", (e: any, ctx: any) => {
    if (failure && !e.aborted) post("agent_end", { error: failure });
    failure = undefined;
    if (e.aborted) {
      const editor: string = ctx.ui?.getEditorText?.() ?? "";
      for (const text of queued) if (editor.includes(text)) post("returned", { text });
    }
    queued.clear();
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
  // A shell command's end is reported too (`tool_end`), so Rails can see which files it changed (ADR 0016).
  const EDITS = new Set(["edit", "write"]);
  const editing = new Map<string, { tool: string; input: unknown }>();
  const shells = new Set<string>();

  pi.on("tool_call", (e: any) => {
    if (mayAsk(e.input)) asking.set(e.toolCallId, e.input);
    // Calls another tool made (codemode's, through ctx.executeTool) count only when they may change files: edits and
    // shell commands. Their reads and the like would only crowd the board.
    if (e.parentToolCallId && !EDITS.has(e.toolName) && e.toolName !== "bash") return;
    post("tool", { tool: e.toolName, input: e.input, started: true, id: e.toolCallId });
    if (EDITS.has(e.toolName)) editing.set(e.toolCallId, { tool: e.toolName, input: e.input });
    if (e.toolName === "bash") shells.add(e.toolCallId);
  });
  pi.on("tool_execution_end", (e: any) => {
    asking.delete(e.toolCallId);
    const edit = editing.get(e.toolCallId);
    editing.delete(e.toolCallId);
    if (edit && !e.isError) post("tool", edit);
    if (shells.delete(e.toolCallId)) post("tool_end", { id: e.toolCallId });
  });
  pi.on("ui_prompt_start", (e: any) => {
    const input = [...asking.values()].at(-1);
    post("ui_prompt_start", { title: e.title ?? "", kind: e.kind, ...(input ? { input } : {}) });
  });
  pi.on("ui_prompt_end", () => post("ui_prompt_end", {}));
  pi.on("agent_end", (e: any) => {
    asking.clear();
    editing.clear();
    shells.clear();
    const last = [...(e.messages ?? [])].reverse().find((m: any) => m.role === "assistant");
    if (last?.stopReason === "error") return void (failure = last?.errorMessage ?? "the turn failed"); // reported once pi settles
    failure = undefined;
    // Escape aborts the run: it stopped, it didn't finish.
    if (last?.stopReason === "aborted") post("agent_end", { aborted: true });
    else post("agent_end", { text: textOf(last) });
  });
  pi.on("session_shutdown", () => {
    stopped = true;
    post("session_shutdown", {});
  });
}
