import { afterEach, describe, expect, it, vi } from "vitest";
import railsBridge from "./rails.ts";

/** The extension with a fake pi and fetch: its handlers by event, and what it posted to Rails. */
function load({ mcp = true } = {}) {
  vi.stubEnv("RAILS_BRIDGE", "http://rails.test/bridge/p1");
  vi.stubEnv("RAILS_PANEL_TOKEN", "tok");
  const posted: { event: string; body: any }[] = [];
  vi.stubGlobal("fetch", (url: string, init: any) => {
    posted.push({ event: url.split("/pi/")[1], body: JSON.parse(init.body) });
    return Promise.resolve(new Response("{}"));
  });
  const handlers = new Map<string, (e: any, ctx?: any) => void>();
  const servers: [string, any][] = [];
  railsBridge({
    on: (event: string, fn: (e: any, ctx?: any) => void) => handlers.set(event, fn),
    ...(mcp ? { registerMcpServer: (name: string, config: unknown) => servers.push([name, config]) } : {}),
  });
  const fire = (event: string, e: any) => handlers.get(event)!(e, { ui: {} });
  return { posted, fire, servers };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the pi extension", () => {
  it("connects the agent tools' MCP server with the panel's token (ADR 0018)", () => {
    const { servers } = load();
    expect(servers).toEqual([["rails", expect.objectContaining({ url: "http://rails.test/bridge/p1/mcp", headers: { Authorization: "Bearer tok" }, exposure: "direct" })]]);
  });

  it("still loads in a pi without registerMcpServer", () => {
    expect(() => load({ mcp: false })).not.toThrow();
  });

  it("reports edits and shell commands another tool made (codemode's), but not its reads", () => {
    const { posted, fire } = load();
    fire("tool_call", { toolCallId: "c1", toolName: "codemode", input: { code: "…" } });
    fire("tool_call", { toolCallId: "n1", parentToolCallId: "c1", toolName: "read", input: { path: "src/a.js" } });
    fire("tool_call", { toolCallId: "n2", parentToolCallId: "c1", toolName: "edit", input: { path: "src/engine/input.js" } });
    fire("tool_execution_end", { toolCallId: "n2", parentToolCallId: "c1", isError: false });
    fire("tool_call", { toolCallId: "n3", parentToolCallId: "c1", toolName: "bash", input: { command: "sed -i '' s/a/b/ src/main.js" } });
    fire("tool_execution_end", { toolCallId: "n3", parentToolCallId: "c1", isError: false });
    const tools = posted.filter((p) => p.event === "tool").map((p) => [p.body.tool, p.body.input.path ?? p.body.input.command ?? "", !!p.body.started]);
    expect(tools).toEqual([
      ["codemode", "", true],
      ["edit", "src/engine/input.js", true],
      ["edit", "src/engine/input.js", false], // the edit worked
      ["bash", "sed -i '' s/a/b/ src/main.js", true],
    ]);
    expect(posted.filter((p) => p.event === "tool_end").map((p) => p.body.id)).toEqual(["n3"]);
  });

  const assistant = (stopReason: string, extra: object = {}) => ({ messages: [{ role: "assistant", stopReason, content: [{ type: "text", text: "Done." }], ...extra }] });
  const ends = (posted: { event: string; body: any }[]) => posted.filter((p) => p.event === "agent_end").map((p) => p.body);

  it("doesn't report a failed response pi retries by itself, only how the turn ends", () => {
    const { posted, fire } = load();
    fire("agent_end", assistant("error", { errorMessage: "fetch failed" }));
    fire("agent_end", assistant("stop")); // the retry worked
    fire("agent_settled", { aborted: false });
    expect(ends(posted)).toEqual([{ sessionId: "", cwd: "", text: "Done." }]);
  });

  it("reports a failure that's still the outcome once pi settles", () => {
    const { posted, fire } = load();
    fire("agent_end", assistant("error", { errorMessage: "fetch failed" }));
    expect(ends(posted)).toEqual([]);
    fire("agent_settled", { aborted: false });
    expect(ends(posted)).toEqual([{ sessionId: "", cwd: "", error: "fetch failed" }]);
  });

  it("reports a stopped turn at once", () => {
    const { posted, fire } = load();
    fire("agent_end", assistant("aborted"));
    expect(ends(posted)).toEqual([{ sessionId: "", cwd: "", aborted: true }]);
  });

  it("doesn't report a nested edit that failed as a change", () => {
    const { posted, fire } = load();
    fire("tool_call", { toolCallId: "n1", parentToolCallId: "c1", toolName: "write", input: { path: "x.js" } });
    fire("tool_execution_end", { toolCallId: "n1", parentToolCallId: "c1", isError: true });
    expect(posted.filter((p) => p.event === "tool" && !p.body.started)).toEqual([]);
  });
});
