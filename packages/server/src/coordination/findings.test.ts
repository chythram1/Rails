// Findings (ADR 0029): a reply that names work in another session's files wakes the Coordinator, by Rails' own rule
// (no decision model needed); the decision model only judges the same in shadow.
import { fauxProvider } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { messageFromAgent } from "../bridge/agentTools.ts";
import { receive } from "../bridge/index.ts";
import { panels, projects, settings } from "../db.ts";
import { findingToJudge } from "./decisions.ts";
import { findingsIn, noteFinding } from "./findings.ts";
import { models, refOf } from "../settings/models.ts";
import { setOwner } from "./owners.ts";
import { createSprocket, listMessages, projectChat, updateSettings } from "../sprockets/sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
beforeEach(() => settings.set("defaultModel", refOf(faux.getModel())));
const look = { character: "cog", color: "pink", accessory: "none" } as const;

/** Engine (Claude Code) and UI (pi), UI having changed src/ui/audio.js; with a Coordinator unless `alone`. */
function setup({ alone = false } = {}) {
  const project = projects.create("game", `/work/findings-${Math.random()}`);
  const engine = panels.create({ projectId: project.id, kind: "claude", title: "Engine", sessionId: `e-${Math.random()}` });
  const ui = panels.create({ projectId: project.id, kind: "pi", title: "UI" });
  receive(ui.id, "pi", "prompt", { text: "Build the UI" });
  receive(ui.id, "pi", "tool", { cwd: project.path, tool: "write", input: { path: "src/ui/audio.js" } });
  receive(ui.id, "pi", "agent_end", { text: "The UI is in." });
  receive(engine.id, "claude", "UserPromptSubmit", { prompt: "Wire the game in" });
  receive(engine.id, "claude", "PostToolUse", { tool_name: "Edit", tool_input: { file_path: `${project.path}/src/main.js` } });
  const lead = alone ? undefined : createSprocket({ name: "Lead", look });
  if (lead) updateSettings(lead.id, { projectId: project.id });
  return { project, engine, ui, lead };
}

const MISMATCH = "Wired src/game into main.js; all 32 tests pass. One thing: audio.js listens for shot, hit and explosion, but the game emits projectile:fired, projectile:hit and projectile:exploded, so no sounds play.";

describe("findings (ADR 0029)", () => {
  it("finds another session's file named next to a problem, by path or by name", () => {
    const { engine, ui } = setup();
    expect(findingsIn(engine, MISMATCH)).toEqual([{ panelId: ui.id, files: ["src/ui/audio.js"] }]);
    expect(findingsIn(engine, "The HUD in src/ui/audio.js doesn't get the wave events.")).toEqual([{ panelId: ui.id, files: ["src/ui/audio.js"] }]);
  });

  it("leaves mentions without a problem, files it changed itself, and itself out", () => {
    const { engine, ui } = setup();
    expect(findingsIn(engine, "main.js now imports audio.js and calls play() on each wave.")).toEqual([]);
    expect(findingsIn(engine, "main.js still needs a pause key, but it's done now.")).toEqual([]); // its own file
    expect(findingsIn(ui, "audio.js still needs a mute key.")).toEqual([]); // its own file
  });

  it("takes a folder by its owner only, not by files others changed in it (test run 8)", () => {
    const { project, engine, ui } = setup();
    receive(ui.id, "pi", "tool", { cwd: project.path, tool: "write", input: { path: "tests/ui.test.js" } });
    expect(findingsIn(engine, "Gameplay said `node --test tests/` passed, but on Node 24 that form errors.")).toEqual([]);
    expect(findingsIn(engine, "tests/ui.test.js still expects the old shop click, which is wrong now.")).toEqual([{ panelId: ui.id, files: ["tests/ui.test.js"] }]);
    setOwner(project, ui, ["src/ui"]);
    expect(findingsIn(engine, "Everything under src/ui/ still draws at the old offsets, which is wrong.")).toEqual([{ panelId: ui.id, files: ["src/ui"] }]);
  });

  it("goes by who owns a path too, even one its owner hasn't changed lately", () => {
    const { project, engine, ui } = setup();
    setOwner(project, ui, ["src/ui"]);
    expect(findingsIn(engine, "src/ui/shop.js shows 0 dmg for the Frost Vent, which is wrong.")).toEqual([{ panelId: ui.id, files: ["src/ui/shop.js"] }]);
  });

  it("wakes the Coordinator with a finding event, once per file, unless the session told them itself", async () => {
    const { engine, ui, lead } = setup();
    expect(await noteFinding(engine, MISMATCH)).toBe(true);
    const event = listMessages(projectChat(lead!.id)).at(-1)!;
    expect(event).toMatchObject({ author: "event", event: { what: "finding", panelId: engine.id, findings: [{ panelId: ui.id, kind: "pi", title: "UI", files: ["src/ui/audio.js"] }] } });
    expect(event.text).toContain("projectile:exploded");
    expect(await noteFinding(engine, MISMATCH)).toBe(false); // the same file again, so soon
    // A reply that asks the user wakes it as a question already.
    const { engine: e2 } = setup();
    expect(await noteFinding(e2, `${MISMATCH} Should I tell the UI session?`)).toBe(false);
    // The session messaged it itself (ADR 0018).
    const { engine: e3, ui: u3 } = setup();
    await messageFromAgent(e3.id, u3.id.slice(0, 8), "audio.js listens for the wrong events: use projectile:*.");
    expect(await noteFinding(e3, MISMATCH)).toBe(false);
  });

  it("needs no decision model, and no Coordinator means nothing to wake", async () => {
    settings.set("decisionModel", null);
    const { engine } = setup({ alone: true });
    expect(await noteFinding(engine, MISMATCH)).toBe(false);
    const { engine: e2 } = setup();
    expect(await noteFinding(e2, MISMATCH)).toBe(true);
  });

  it("gives the decision model the same turn end to judge in shadow, with the other sessions and Rails' answer", async () => {
    const { project, engine, ui } = setup();
    setOwner(project, ui, ["src/ui"]);
    const item = await findingToJudge(engine, MISMATCH);
    expect(item).toMatchObject({ question: "finding", rails: "finding" });
    expect(item!.context!.other_sessions).toBe('- "UI" (pi), owns src/ui, changed lately src/ui/audio.js');
    expect((await findingToJudge(engine, "main.js calls audio.play() now."))!.rails).toBe("no finding");
    expect(await findingToJudge(engine, "Done. Should I add tests?")).toBeUndefined(); // asks: the turn_end question covers it
  });
});
