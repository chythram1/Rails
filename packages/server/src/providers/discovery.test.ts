import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conversation, sessionsFor } from "./index.ts";
import { firstLine } from "./util.ts";

// Fixture transcripts go into the empty provider homes that vitest.config.ts points the server at.
const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
function write(file: string, lines: object[]) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, jsonl(lines));
}

const project = "/work/app";
const ts = "2026-10-01T10:00:00.000Z";

write(join(process.env.CLAUDE_HOME!, "projects", "-work-app", "c1.jsonl"), [
  { type: "user", isMeta: true, cwd: project, sessionId: "c1", timestamp: ts, message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { type: "user", cwd: project, sessionId: "c1", timestamp: ts, message: { role: "user", content: [{ type: "text", text: "<system-reminder>noise</system-reminder>" }] } },
  { type: "user", cwd: project, sessionId: "c1", timestamp: ts, message: { role: "user", content: "Fix the login bug\nmore detail" } },
  // Each model message can be split over several lines that share its id; tool results come between messages.
  { type: "assistant", timestamp: ts, message: { id: "m1", role: "assistant", content: [{ type: "text", text: "Looking." }] } },
  { type: "assistant", timestamp: ts, message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] } },
  { type: "user", timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "file" }] } },
  { type: "assistant", timestamp: ts, message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Found it." }] } },
  { type: "assistant", timestamp: ts, message: { id: "m2", role: "assistant", content: [{ type: "text", text: "Fixed." }] } },
  { type: "assistant", isSidechain: true, timestamp: ts, message: { id: "m3", role: "assistant", content: [{ type: "text", text: "subagent noise" }] } },
  { type: "user", timestamp: ts, message: { role: "user", content: "Thanks" } },
]);
write(join(process.env.CLAUDE_HOME!, "projects", "-work-app", "c2.jsonl"), [
  { type: "user", cwd: `${project}/packages/web`, sessionId: "c2", timestamp: ts, message: { role: "user", content: "hi" } },
  { type: "custom-title", customTitle: "Named by user" },
]);
write(join(process.env.CLAUDE_HOME!, "projects", "-work-app", "c4.jsonl"), [
  { type: "user", cwd: project, sessionId: "c4", timestamp: ts, message: { role: "user", content: '\n\n<pasted_content id="c959">\nYou own the engine.\nRead BRIEF.md.\n</pasted_content id="c959">\n' } },
]);
write(join(process.env.CLAUDE_HOME!, "projects", "-work-app", "c5.jsonl"), [
  { type: "user", cwd: project, sessionId: "c5", timestamp: ts, message: { role: "user", content: "Build the engine" } },
  { type: "ai-title", aiTitle: "Engine setup", sessionId: "c5" },
  { type: "ai-title", aiTitle: "Engine and integration setup", sessionId: "c5" },
]);
write(join(process.env.CLAUDE_HOME!, "projects", "-work-other", "c3.jsonl"), [
  { type: "user", cwd: "/work/application", sessionId: "c3", timestamp: ts, message: { role: "user", content: "not in /work/app" } },
]);
write(join(process.env.PI_HOME!, "sessions", "--work-app--", "2026_p1.jsonl"), [
  { type: "session", version: 3, id: "p1", timestamp: ts, cwd: project },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Add tests" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Adding them." }, { type: "toolCall", id: "c", name: "write", arguments: {} }] } },
  { type: "message", message: { role: "toolResult", toolCallId: "c", toolName: "write", content: [{ type: "text", text: "ok" }] } },
]);
// pi's /name appends a session_info line; the latest counts, and an empty one clears the name (pi 1.3).
write(join(process.env.PI_HOME!, "sessions", "--work-app--", "2026_p2.jsonl"), [
  { type: "session", version: 3, id: "p2", timestamp: ts, cwd: project },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Build the HUD" }] } },
  { type: "session_info", name: "HUD" },
  { type: "session_info", name: "UI" },
]);
write(join(process.env.PI_HOME!, "sessions", "--work-app--", "2026_p3.jsonl"), [
  { type: "session", version: 3, id: "p3", timestamp: ts, cwd: project },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Draw the map" }] } },
  { type: "session_info", name: "Map" },
  { type: "session_info", name: "" },
]);
write(join(process.env.CODEX_HOME!, "sessions", "2026", "10", "01", "rollout-2026-10-01T10-00-00-x2.jsonl"), [
  { type: "session_meta", payload: { id: "x2", cwd: project, timestamp: ts } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Balance the waves" }] } },
]);
// Codex's /rename appends to session_index.jsonl, not to the rollout: the latest non-empty name counts (0.163).
writeFileSync(
  join(process.env.CODEX_HOME!, "session_index.jsonl"),
  jsonl([
    { id: "x2", thread_name: "Waves", updated_at: ts },
    { id: "x9", thread_name: "Another project's thread", updated_at: ts },
    { id: "x2", thread_name: "Gameplay", updated_at: ts },
    { id: "x2", thread_name: " ", updated_at: ts },
  ]),
);
// A thread Rails started for a new panel that closed before its first prompt (ADR 0030): only its metadata.
write(join(process.env.CODEX_HOME!, "sessions", "2026", "10", "01", "rollout-2026-10-01T10-00-00-x3.jsonl"), [
  { type: "session_meta", payload: { id: "x3", cwd: project, timestamp: ts, dynamic_tools: [{ type: "namespace", name: "rails" }] } },
]);
write(join(process.env.CODEX_HOME!, "sessions", "2026", "10", "01", "rollout-2026-10-01T10-00-00-x1.jsonl"), [
  { type: "session_meta", payload: { id: "x1", cwd: project, timestamp: ts } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…</environment_context>" }] } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Rename the API" }] } },
  { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "a note for the model" }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Renamed." }] } },
]);

describe("discovery", () => {
  it("finds sessions of all three providers inside a project, including subfolders, not empty Codex threads", async () => {
    const found = await sessionsFor(project);
    expect(found.map((s) => `${s.provider}:${s.id}`).sort()).toEqual(["claude:c1", "claude:c2", "claude:c4", "claude:c5", "codex:x1", "codex:x2", "pi:p1", "pi:p2", "pi:p3"]);
  });

  it("titles a session by its first real prompt, skipping harness noise", async () => {
    const byId = Object.fromEntries((await sessionsFor(project)).map((s) => [s.id, s.title]));
    expect(byId.c1).toBe("Fix the login bug");
    expect(byId.c2).toBe("Named by user");
    expect(byId.c4).toBe("You own the engine."); // a pasted prompt: what's inside the tags
    expect(byId.c5).toBe("Engine and integration setup"); // Claude Code's own title, the latest
    expect(byId.p1).toBe("Add tests");
    expect(byId.x1).toBe("Rename the API");
  });

  it("uses the name the user gave a session in pi or Codex", async () => {
    const byId = Object.fromEntries((await sessionsFor(project)).map((s) => [s.id, s.title]));
    expect(byId.p2).toBe("UI"); // the latest /name
    expect(byId.p3).toBe("Draw the map"); // named, then cleared
    expect(byId.x2).toBe("Gameplay"); // the latest /rename with a name
    appendFileSync(join(process.env.CODEX_HOME!, "session_index.jsonl"), jsonl([{ id: "x2", thread_name: "Balance", updated_at: ts }]));
    const again = Object.fromEntries((await sessionsFor(project)).map((s) => [s.id, s.title]));
    expect(again.x2).toBe("Balance"); // a rename shows though the rollout didn't change
  });

  it("reads each agent's conversation without tool calls, tool results or harness noise", async () => {
    const byId = Object.fromEntries((await sessionsFor(project)).map((s) => [s.id, s]));
    const talk = async (id: string) => (await conversation(byId[id])).map((m) => `${m.role}: ${m.text}`);
    expect(await talk("c1")).toEqual(["user: Fix the login bug\nmore detail", "agent: Looking.", "agent: Found it.\nFixed.", "user: Thanks"]);
    expect(await talk("p1")).toEqual(["user: Add tests", "agent: Adding them."]);
    expect(await talk("x1")).toEqual(["user: Rename the API", "agent: Renamed."]);
  });

  it("doesn't match a sibling folder that only shares a prefix", async () => {
    expect((await sessionsFor(project)).some((s) => s.id === "c3")).toBe(false);
  });
});

describe("titles from first lines", () => {
  it("takes a pasted prompt's text, whether it spans lines or not", () => {
    expect(firstLine('<pasted_content id="x">Fix the bug</pasted_content id="x">')).toBe("Fix the bug");
    expect(firstLine('\n<pasted_content id="x">\nFix the bug\nmore\n</pasted_content id="x">\n')).toBe("Fix the bug");
    expect(firstLine("Plain prompt")).toBe("Plain prompt");
  });
});
