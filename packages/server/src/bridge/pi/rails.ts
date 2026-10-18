// The Rails extension for pi (ADR 0007). Rails loads it with `pi --extension` in panels it starts; it
// reports what the session does to Rails' bridge, using RAILS_BRIDGE and RAILS_PANEL_TOKEN from the
// panel's environment. pi loads this file directly (TypeScript through jiti), so it imports nothing: the
// types are loose on purpose. It never blocks pi: reports that fail are dropped.
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

  pi.on("session_start", (_e: any, ctx: any) => {
    sessionId = ctx.sessionManager.getSessionId();
    cwd = ctx.sessionManager.getCwd();
    post("session_start", {});
  });
  pi.on("before_agent_start", (e: any) => {
    if (e.messageType === "user") post("prompt", { text: e.prompt ?? "" });
  });
  pi.on("tool_call", (e: any) => {
    if (!e.parentToolCallId) post("tool", { tool: e.toolName, input: e.input });
  });
  pi.on("ui_prompt_start", (e: any) => post("ui_prompt_start", { title: e.title ?? "" }));
  pi.on("ui_prompt_end", () => post("ui_prompt_end", {}));
  pi.on("agent_end", (e: any) => {
    const last = [...(e.messages ?? [])].reverse().find((m: any) => m.role === "assistant");
    const failed = last?.stopReason === "error";
    post("agent_end", failed ? { error: last?.errorMessage ?? "the turn failed" } : { text: textOf(last) });
  });
  pi.on("session_shutdown", () => post("session_shutdown", {}));
}
