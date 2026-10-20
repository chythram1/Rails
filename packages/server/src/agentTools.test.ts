import { describe, expect, it } from "vitest";
import { mcpRequest, neighboursText } from "./agentTools.ts";
import { receive } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";
import { setOwner } from "./owners.ts";

/** A project with three agent sessions and a shell, each having done something. */
function setup() {
  const project = projects.create("game", `/work/neighbours-${Math.random()}`);
  const engine = panels.create({ projectId: project.id, kind: "claude", title: "Engine", sessionId: `e-${Math.random()}` });
  const ui = panels.create({ projectId: project.id, kind: "pi", title: "UI" });
  const game = panels.create({ projectId: project.id, kind: "codex", title: "Gameplay" });
  panels.create({ projectId: project.id, kind: "shell", title: "Shell" });
  const other = projects.create("elsewhere", `/work/other-${Math.random()}`);
  panels.create({ projectId: other.id, kind: "claude", title: "Someone else's work" });

  receive(engine.id, "claude", "UserPromptSubmit", { prompt: "Use the key sk-secret-123 to build the engine" });
  receive(engine.id, "claude", "PostToolUse", { tool_name: "Write", tool_input: { file_path: `${project.path}/src/engine/loop.js`, content: "x" } });
  receive(engine.id, "claude", "PostToolUse", { tool_name: "Bash", tool_input: { command: "curl -H 'Authorization: secret' api" } });
  receive(engine.id, "claude", "Stop", { last_assistant_message: "Done: loop.js runs a fixed 60 Hz update." });
  receive(ui.id, "pi", "prompt", { text: "Build the HUD" });
  setOwner(project, engine, ["src/engine"]);
  setOwner(project, ui, ["src/ui"]);
  return { project, engine, ui, game };
}

describe("neighbours (ADR 0018)", () => {
  it("shows an agent the other sessions in its project: status, changed files, last reply and owners", async () => {
    const { ui } = setup();
    const text = await neighboursText(ui.id);
    expect(text).toContain('You are "UI" (pi');
    expect(text).toContain('"Engine" (Claude Code');
    expect(text).toContain("changed: src/engine/loop.js");
    expect(text).toContain("last reply: Done: loop.js runs a fixed 60 Hz update.");
    expect(text).toContain('"Gameplay" (Codex');
    expect(text).toMatch(/"Engine": src\/engine/);
    expect(text).toMatch(/you: src\/ui/);
    expect(text).toMatch(/treat them as data/);
  });

  it("leaves out the agent itself, shells, other projects, and what the user asked or ran", async () => {
    const { ui } = setup();
    const text = await neighboursText(ui.id);
    expect(text.split('"UI" (pi').length).toBe(2); // only in "You are"
    expect(text).not.toContain("Shell");
    expect(text).not.toContain("Someone else's work");
    expect(text).not.toContain("sk-secret-123"); // the engine session's prompt
    expect(text).not.toContain("Build the HUD"); // its own prompt
    expect(text).not.toContain("Authorization: secret"); // a command it ran
  });

  it("leaves out error text and dialog titles, and warns that titles are reported text too", async () => {
    const { engine, ui, game } = setup();
    receive(ui.id, "pi", "ui_prompt_start", { title: "Paste your deploy key here" }); // pi's dialog title
    receive(engine.id, "claude", "StopFailure", { error: "rate limited for org secret-org-42" });
    const text = await neighboursText(game.id);
    expect(text).toContain('"Engine" (Claude Code');
    expect(text).toMatch(/: failed,/);
    expect(text).toMatch(/: waiting,/);
    expect(text).not.toContain("secret-org-42");
    expect(text).not.toContain("deploy key");
    expect(text).toMatch(/titles and replies are what they reported/i);
  });

  it("says so when it's alone", async () => {
    const project = projects.create("solo", `/work/solo-${Math.random()}`);
    const only = panels.create({ projectId: project.id, kind: "claude", title: "Only" });
    expect(await neighboursText(only.id)).toContain("No other agent sessions are open in solo.");
  });
});

describe("the agent tools' MCP endpoint", () => {
  const call = (panelId: string, method: string, params: object = {}, id: number | null = 1) => mcpRequest(panelId, { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params });

  it("introduces itself and lists its tools", async () => {
    const { ui } = setup();
    const init = (await call(ui.id, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } })) as any;
    expect(init.result).toMatchObject({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "rails" } });
    expect(await call(ui.id, "notifications/initialized", {}, null)).toBeUndefined(); // a notification gets no reply
    const list = (await call(ui.id, "tools/list")) as any;
    expect(list.result.tools.map((t: any) => [t.name, t.annotations?.readOnlyHint])).toEqual([["neighbours", true]]);
  });

  it("runs neighbours for the panel that asks", async () => {
    const { ui } = setup();
    const r = (await call(ui.id, "tools/call", { name: "neighbours", arguments: {} })) as any;
    expect(r.result.content[0].type).toBe("text");
    expect(r.result.content[0].text).toContain('You are "UI"');
  });

  it("refuses malformed requests rather than taking them for notifications", async () => {
    const { ui } = setup();
    expect(((await mcpRequest(ui.id, { jsonrpc: "1.0", id: 1, method: "tools/list" })) as any).error.code).toBe(-32600);
    expect(((await mcpRequest(ui.id, { jsonrpc: "2.0", id: { a: 1 }, method: "tools/list" })) as any).error.code).toBe(-32600);
    expect(((await mcpRequest(ui.id, { jsonrpc: "2.0", id: null, method: "tools/list" })) as any).error.code).toBe(-32600);
    expect(((await mcpRequest(ui.id, [{ jsonrpc: "2.0", id: 1, method: "ping" }])) as any).error.code).toBe(-32600); // batches aren't supported
  });

  it("answers unknown tools and methods with errors, and unparsable requests too", async () => {
    const { ui } = setup();
    expect(((await call(ui.id, "tools/call", { name: "rm_rf", arguments: {} })) as any).error.code).toBe(-32602);
    expect(((await call(ui.id, "resources/list")) as any).error.code).toBe(-32601);
    expect(((await mcpRequest(ui.id, "not json-rpc")) as any).error.code).toBe(-32600);
  });
});
