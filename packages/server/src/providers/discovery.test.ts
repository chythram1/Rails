import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conversation, sessionsFor } from "./index.ts";

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
write(join(process.env.CLAUDE_HOME!, "projects", "-work-other", "c3.jsonl"), [
  { type: "user", cwd: "/work/application", sessionId: "c3", timestamp: ts, message: { role: "user", content: "not in /work/app" } },
]);
write(join(process.env.PI_HOME!, "sessions", "--work-app--", "2026_p1.jsonl"), [
  { type: "session", version: 3, id: "p1", timestamp: ts, cwd: project },
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Add tests" }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Adding them." }, { type: "toolCall", id: "c", name: "write", arguments: {} }] } },
  { type: "message", message: { role: "toolResult", toolCallId: "c", toolName: "write", content: [{ type: "text", text: "ok" }] } },
]);
write(join(process.env.CODEX_HOME!, "sessions", "2026", "10", "01", "rollout-2026-10-01T10-00-00-x1.jsonl"), [
  { type: "session_meta", payload: { id: "x1", cwd: project, timestamp: ts } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>…</environment_context>" }] } },
  { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Rename the API" }] } },
  { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "a note for the model" }] } },
  { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Renamed." }] } },
]);

describe("discovery", () => {
  it("finds sessions of all three providers inside a project, including subfolders", async () => {
    const found = await sessionsFor(project);
    expect(found.map((s) => `${s.provider}:${s.id}`).sort()).toEqual(["claude:c1", "claude:c2", "codex:x1", "pi:p1"]);
  });

  it("titles a session by its first real prompt, skipping harness noise", async () => {
    const byId = Object.fromEntries((await sessionsFor(project)).map((s) => [s.id, s.title]));
    expect(byId.c1).toBe("Fix the login bug");
    expect(byId.c2).toBe("Named by user");
    expect(byId.p1).toBe("Add tests");
    expect(byId.x1).toBe("Rename the API");
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
