// The Rails extension for pi (ADR 0007). Rails loads it with `pi --extension` in panels it starts; it
// reports what the session does to Rails' bridge, using RAILS_BRIDGE and RAILS_PANEL_TOKEN from the
// panel's environment, and long-polls Rails for replies the user sends from a Sprocket's chat (ADR 0010),
// which it hands to pi as the user's next message when pi is idle (and tells Rails whether it did), answers the
// dialogs it can with what the user sends (ADR 0027), and connects the agent tools' MCP server (ADR 0018). pi loads this file directly (TypeScript through jiti),
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

  // Reports go one at a time, in order: sent side by side, a tool call's report could arrive after the dialog it
  // opened, and Rails would take the session for moving on (seen live with a question tool).
  let reports: Promise<unknown> = Promise.resolve();
  const post = (event: string, data: Record<string, unknown>) => {
    const body = JSON.stringify({ sessionId, cwd, ...data });
    reports = reports.then(() =>
      fetch(`${base}/pi/${event}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(3000),
      }).catch(() => {}),
    );
  };

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
        const { messages } = (await r.json()) as { messages?: { id?: string; text?: string; queue?: boolean; answer?: any }[] };
        for (const m of messages ?? []) {
          // An answer to a dialog (ADR 0027): only the one still open with that id takes it.
          if (m?.answer) {
            const d = open.get(m.answer.dialog);
            const error = d ? await d.answer(m.answer) : "The dialog has closed.";
            post("delivered", { id: m.id, ok: !error, ...(error ? { error } : {}) });
            continue;
          }
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

  // Dialogs Rails can answer (ADR 0027), by the id it reports with the dialog: pi's own select and input, whichever
  // extension opens them (wrapped on pi's shared ui, so Rails can close one with its abort signal and return the
  // answer in its place), and questionnaires from extensions that take answers from outside: rpiv-ask-user-question
  // (2.13.9 and later) through its rpiv:ask-user:answer event. Other dialogs are answered in the panel.
  type Answer = { option?: number; text?: string };
  const open = new Map<string, { answer: (a: Answer) => Promise<string | undefined> }>();
  /** The dialog about to open, reported with its ui_prompt_start. */
  let next: { id: string; kind: string; options?: string[] } | undefined;
  let seq = 0;

  const WRAPPED = Symbol.for("rails.answerable-dialogs");
  const wrapUi = (ui: any) => {
    if (!ui || ui[WRAPPED] || typeof ui.select !== "function" || typeof ui.input !== "function") return;
    try {
      ui[WRAPPED] = true;
      for (const kind of ["select", "input"] as const) {
        const original = ui[kind];
        ui[kind] = (title: string, arg: any, opts?: any) => {
          if (opts?.signal?.aborted) return original(title, arg, opts);
          const id = `${kind}-${++seq}`;
          const options = kind === "select" && Array.isArray(arg) ? arg.filter((o: unknown) => typeof o === "string") : undefined;
          const closer = new AbortController();
          opts?.signal?.addEventListener?.("abort", () => closer.abort(), { once: true });
          let fromRails: ((value: string) => void) | undefined;
          const answered = new Promise<string>((resolve) => (fromRails = resolve));
          open.set(id, {
            answer: async (a) => {
              const value = kind === "select" ? (Number.isInteger(a.option) ? options?.[a.option!] : undefined) : a.text?.trim() ? a.text : undefined;
              if (value === undefined) return "That answer doesn't fit the dialog.";
              open.delete(id);
              fromRails!(value);
              closer.abort();
              return undefined;
            },
          });
          next = { id, kind, ...(options ? { options } : {}) };
          const shown = Promise.resolve(original(title, arg, { ...opts, signal: closer.signal }));
          return Promise.race([answered, shown]).finally(() => open.delete(id));
        };
      }
    } catch {
      // pi's ui isn't what this expects: its dialogs are answered in the panel
    }
  };

  const RPIV_PROMPT = "rpiv:ask-user:prompt";
  const RPIV_BLOCKED = "rpiv:ask-user:blocked";
  const RPIV_ANSWER = "rpiv:ask-user:answer";
  const RPIV_RESULT = "rpiv:ask-user:answer-result";
  pi.events?.on?.(RPIV_PROMPT, (data: any) => {
    const toolCallId = typeof data?.toolCallId === "string" ? data.toolCallId : undefined;
    const questions = Array.isArray(data?.questions) ? data.questions : [];
    if (!toolCallId) return;
    const id = `rpiv-${toolCallId}`;
    open.set(id, {
      answer: (a) =>
        new Promise((resolve) => {
          const requestId = `rails-${++seq}`;
          const done = (error?: string) => {
            clearTimeout(timer);
            off?.();
            if (!error) open.delete(id);
            resolve(error);
          };
          const off = pi.events.on(RPIV_RESULT, (v: any) => v?.requestId === requestId && done(v.ok ? undefined : v.reason || v.code || "It was turned down."));
          // Versions before 2.13.9 don't listen: nothing answers.
          const timer = setTimeout(() => done("The question extension didn't take the answer: answer it in the panel."), 3000);
          const entry = Number.isInteger(a.option) ? { questionIndex: 0, optionIndexes: [a.option] } : { questionIndex: 0, text: a.text };
          pi.events.emit(RPIV_ANSWER, { toolCallId, requestId, answers: [entry] });
        }),
    });
    if (questions.length) next = { id, kind: "questionnaire" };
  });
  pi.events?.on?.(RPIV_BLOCKED, (data: any) => {
    if (data?.active !== false || typeof data?.toolCallId !== "string") return;
    open.delete(`rpiv-${data.toolCallId}`);
    if (next?.id === `rpiv-${data.toolCallId}`) next = undefined; // it never showed
  });

  pi.on("session_start", (_e: any, ctx: any) => {
    wrapUi(ctx.ui);
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
  pi.on("before_agent_start", (e: any, ctx: any) => {
    wrapUi(ctx?.ui); // pi may have set up a new ui since (a reload)
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
  const running = new Map<string, { tool: string; input: unknown }>();

  pi.on("tool_call", (e: any) => {
    if (mayAsk(e.input)) asking.set(e.toolCallId, e.input);
    // Calls another tool made (codemode's, through ctx.executeTool) count only when they may change files: edits and
    // shell commands. Their reads and the like would only crowd the board.
    if (e.parentToolCallId && !EDITS.has(e.toolName) && e.toolName !== "bash") return;
    post("tool", { tool: e.toolName, input: e.input, started: true, id: e.toolCallId });
    if (EDITS.has(e.toolName)) editing.set(e.toolCallId, { tool: e.toolName, input: e.input });
    if (e.toolName === "bash") shells.add(e.toolCallId);
    if (EDITS.has(e.toolName) || e.toolName === "bash") running.set(e.toolCallId, { tool: e.toolName, input: e.input });
  });
  pi.on("tool_execution_end", (e: any) => {
    asking.delete(e.toolCallId);
    running.delete(e.toolCallId);
    const edit = editing.get(e.toolCallId);
    editing.delete(e.toolCallId);
    if (edit && !e.isError) post("tool", edit);
    if (shells.delete(e.toolCallId)) post("tool_end", { id: e.toolCallId });
  });
  pi.on("ui_prompt_start", (e: any) => {
    const input = [...asking.values()].at(-1);
    // Else the call that may change something (an edit, a shell command) running now: what an approval is for.
    const during = input ? undefined : [...running.values()].at(-1);
    const dialog = next;
    next = undefined;
    post("ui_prompt_start", { title: e.title ?? "", kind: e.kind, ...(input ? { input } : {}), ...(during ? { during } : {}), ...(dialog ? { dialog } : {}) });
  });
  pi.on("ui_prompt_end", () => post("ui_prompt_end", {}));
  pi.on("agent_end", (e: any) => {
    asking.clear();
    running.clear();
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
