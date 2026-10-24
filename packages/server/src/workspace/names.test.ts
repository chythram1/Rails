import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionKey } from "@rails/shared";
import { describe, expect, it } from "vitest";
import { messageFromAgent, neighboursText } from "../agentTools.ts";
import { panels, projects } from "../db.ts";
import { projectCapabilities } from "../harness/project.ts";
import { nameSession } from "./names.ts";
import { onPanelsChanged } from "./panels.ts";
import { listProjectSessions } from "./projects.ts";
import { createSprocket, updateSettings } from "../sprockets.ts";
import { sessionTitle } from "./titles.ts";

/** A Claude Code transcript discovery finds in `cwd`, titled by its first prompt. */
function transcript(cwd: string, id: string, prompt: string) {
  const dir = join(process.env.CLAUDE_HOME!, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), JSON.stringify({ type: "user", cwd, sessionId: id, timestamp: new Date().toISOString(), message: { role: "user", content: prompt } }) + "\n");
}

/** A project with an open Claude session (in a transcript), a closed one, and a fresh pi panel with no transcript yet. */
function setup() {
  const project = projects.create("game", `/work/names-${Math.random().toString(36).slice(2)}`);
  const id = () => `s-${Math.random().toString(36).slice(2)}`;
  const [open, closed, fresh] = [id(), id(), id()];
  transcript(project.path, open, "Read BRIEF.md. Build the engine: a fixed-step loop and the canvas");
  transcript(project.path, closed, "Fix the login bug");
  const engine = panels.create({ projectId: project.id, kind: "claude", title: "New Claude Code session", sessionId: open });
  const ui = panels.create({ projectId: project.id, kind: "pi", title: "New pi session", sessionId: fresh });
  return { project, engine, ui, keys: { open: sessionKey("claude", open), closed: sessionKey("claude", closed), fresh: sessionKey("pi", fresh) } };
}

const titles = async (projectId: string) => Object.fromEntries((await listProjectSessions(projectId)).map((s) => [s.key, [s.title, s.agentTitle]]));

describe("naming a session", () => {
  it("shows the name instead of the agent's title, and keeps the agent's title beside it", async () => {
    const { project, engine, keys } = setup();
    expect(await nameSession(project.id, keys.open, "  engine ")).toEqual({ title: "engine" });
    expect((await titles(project.id))[keys.open]).toEqual(["engine", "Read BRIEF.md. Build the engine: a fixed-step loop and the canvas"]);
    expect(await sessionTitle(engine)).toBe("engine");
  });

  it("names a session that isn't open, and one whose agent hasn't written a transcript yet", async () => {
    const { project, ui, keys } = setup();
    await nameSession(project.id, keys.closed, "login");
    expect((await titles(project.id))[keys.closed]).toEqual(["login", "Fix the login bug"]);
    await nameSession(project.id, keys.fresh, "UI");
    expect(await sessionTitle(ui)).toBe("UI");
  });

  it("goes back to the agent's title when the name is cleared", async () => {
    const { project, engine, keys } = setup();
    await nameSession(project.id, keys.open, "engine");
    expect(await nameSession(project.id, keys.open, " ")).toEqual({ title: "Read BRIEF.md. Build the engine: a fixed-step loop and the canvas" });
    expect((await titles(project.id))[keys.open]).toEqual(["Read BRIEF.md. Build the engine: a fixed-step loop and the canvas", undefined]);
    expect(await sessionTitle(engine)).toBe("Read BRIEF.md. Build the engine: a fixed-step loop and the canvas");
  });

  it("keeps names to one short line", async () => {
    const { project, keys } = setup();
    expect(await nameSession(project.id, keys.open, "game\n  engine")).toEqual({ title: "game engine" });
    await expect(nameSession(project.id, keys.open, "x".repeat(41))).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a name another session in the project shows, in any case, but not the session's own", async () => {
    const { project, keys } = setup();
    await nameSession(project.id, keys.open, "engine");
    await expect(nameSession(project.id, keys.fresh, "Engine")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("engine") });
    await expect(nameSession(project.id, keys.fresh, "fix the login bug")).rejects.toMatchObject({ status: 409 });
    expect(await nameSession(project.id, keys.open, "ENGINE")).toEqual({ title: "ENGINE" });
  });

  it("refuses a session that isn't in the project", async () => {
    const { project } = setup();
    const other = setup();
    await expect(nameSession(project.id, other.keys.open, "engine")).rejects.toMatchObject({ status: 404 });
    await expect(nameSession(project.id, "claude:nope", "engine")).rejects.toMatchObject({ status: 404 });
  });

  it("tells every browser, so tabs and the sidebar show the name", async () => {
    const { project, keys } = setup();
    const seen: string[] = [];
    onPanelsChanged((id) => seen.push(id));
    await nameSession(project.id, keys.open, "engine");
    expect(seen).toEqual([project.id]);
  });

  it("is how agents see and reach the session (ADR 0018)", async () => {
    const { project, engine, ui, keys } = setup();
    updateSettings(createSprocket({ name: "Lead", look: { character: "cog", color: "pink", accessory: "none" } }).id, { projectId: project.id });
    await nameSession(project.id, keys.open, "engine");
    await nameSession(project.id, keys.fresh, "ui");
    expect(await neighboursText(ui.id)).toContain('You are "ui"');
    expect(await neighboursText(ui.id)).toContain('"engine" (Claude Code');
    expect(await messageFromAgent(ui.id, "engine", "The HUD needs state.turns.")).toContain('"engine"');
    expect(await messageFromAgent(engine.id, "UI", "Done: state.turns exists.")).toContain('"ui"');
  });

  it("is how the Coordinator sees the session", async () => {
    const { project, keys } = setup();
    await nameSession(project.id, keys.open, "engine");
    const list = projectCapabilities.find((c) => c.name === "list_sessions")!;
    const listed = (await list.run({}, { sprocketId: "s", project, signal: new AbortController().signal })) as { title: string }[];
    expect(listed.map((s) => s.title).sort()).toEqual(["New pi session", "engine"]);
  });
});
