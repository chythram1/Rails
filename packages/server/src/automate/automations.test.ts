// Automations (ADR 0032): a Sprocket runs a prompt on a schedule in its direct chat, and each run gets an outcome.
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutomation, deleteAutomation, getAutomation, listAutomations, runAutomation, startAutomations, stopAutomations, tick, updateAutomation } from "./automations.ts";
import { automationRuns, automations, settings, sprocketRuns } from "../db.ts";
import { createServer, disconnectAll, testServer } from "../mcp.ts";
import { models, refOf } from "../models.ts";
import { idle } from "../sprockets/runs.ts";
import { createSprocket, deleteSprocket, directChat, listMessages, updateSettings } from "../sprockets/sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "bean", color: "teal", accessory: "none" } as const;
beforeEach(() => {
  settings.set("defaultModel", ref);
  startAutomations();
});
afterEach(() => stopAutomations());
afterAll(() => disconnectAll());

let n = 0;
const sprocket = () => createSprocket({ name: `Auto ${++n}`, look });
const script = (code: string) => fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
const lastUser = (c: TranscriptContext) => JSON.stringify(c.messages.filter((m) => m.role === "user").at(-1));
const daily = { kind: "daily" as const, time: "09:00" };
/** The moment just after it's due. */
const dueAt = (id: string) => new Date(Date.parse(automations.get(id)!.nextRunAt!) + 1000);

describe("automations", () => {
  it("checks what it's given and counts when it runs next", () => {
    const s = sprocket();
    expect(() => createAutomation({ name: "", prompt: "x", sprocketId: s.id, schedule: daily, timezone: "UTC" })).toThrow("Give it a name.");
    expect(() => createAutomation({ name: "A", prompt: " ", sprocketId: s.id, schedule: daily, timezone: "UTC" })).toThrow("Say what it should do.");
    expect(() => createAutomation({ name: "A", prompt: "x", sprocketId: "nope", schedule: daily, timezone: "UTC" })).toThrow("Pick a Sprocket");
    expect(() => createAutomation({ name: "A", prompt: "x", sprocketId: s.id, schedule: { kind: "cron", expr: "* * * * *" }, timezone: "UTC" })).toThrow("every 15 minutes");
    // A schedule missing its fields is refused, not a crash.
    expect(() => createAutomation({ name: "A", prompt: "x", sprocketId: s.id, schedule: { kind: "weekly" } as never, timezone: "UTC" })).toThrow("Pick at least one day.");
    expect(() => createAutomation({ name: "A", prompt: "x", sprocketId: s.id, schedule: { kind: "cron" } as never, timezone: "UTC" })).toThrow("five fields");
    const a = createAutomation({ name: "Brief", prompt: "Tell me what's new.", sprocketId: s.id, schedule: daily, timezone: "Europe/Berlin" });
    expect(a.enabled).toBe(true);
    expect(new Date(a.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    // 09:00 in Berlin is 07:00 or 08:00 UTC, whatever the season.
    expect([7, 8]).toContain(new Date(a.nextRunAt!).getUTCHours());
    const off = updateAutomation(a.id, { enabled: false });
    expect(off.nextRunAt).toBeUndefined();
  });

  it("runs once when due, however long the server was away, in its Sprocket's chat; the reply is the summary", async () => {
    const s = sprocket();
    const chat = directChat(s.id);
    const a = createAutomation({ name: "Brief", prompt: "Tell me what's new.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    let told = "";
    faux.setResponses([(c) => ((told = lastUser(c)), fauxAssistantMessage("Two new issues since yesterday.\n\nBoth are small."))]);
    const later = new Date(dueAt(a.id).getTime() + 3 * 86_400_000); // three days of missed runs
    tick(later);
    await idle();
    const [line, reply] = listMessages(chat);
    expect(line).toMatchObject({ author: "automation", text: "Tell me what's new.", automation: { id: a.id, name: "Brief", trigger: "schedule" } });
    expect(reply.text).toBe("Two new issues since yesterday.\n\nBoth are small.");
    expect(told).toContain('Your automation \\"Brief\\" is running now (on its schedule)');
    expect(told).toContain("This is its first run.");
    const { automation, runs } = getAutomation(a.id);
    expect(runs).toMatchObject([{ trigger: "schedule", outcome: "done", summary: "Two new issues since yesterday." }]);
    expect(automation.lastRun?.outcome).toBe("done");
    // The next run counts from then: one day on, not the missed ones.
    expect(Date.parse(automation.nextRunAt!) - later.getTime()).toBeLessThanOrEqual(86_400_000);
    tick(later);
    await idle();
    expect(getAutomation(a.id).runs).toHaveLength(1);
  });

  it("leaves nothing in the chat when there's nothing new, and tells the next run what the last one found", async () => {
    const s = sprocket();
    const chat = directChat(s.id);
    const a = createAutomation({ name: "Watch", prompt: "Any new PRs?", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    faux.setResponses([script('await tools.nothing_new({ summary: "No new PRs since Monday" });'), fauxAssistantMessage("ignored")]);
    runAutomation(a.id);
    await idle();
    expect(getAutomation(a.id).runs).toMatchObject([{ trigger: "manual", outcome: "quiet", summary: "No new PRs since Monday" }]);
    expect(listMessages(chat)).toMatchObject([{ author: "automation", automation: { quiet: true } }]);

    let told = "";
    faux.setResponses([(c) => ((told = JSON.stringify(c.messages)), fauxAssistantMessage("One new PR: #12."))]);
    runAutomation(a.id);
    await idle();
    expect(told).toContain('reported: \\"No new PRs since Monday\\"');
    expect(told.match(/Any new PRs\?/g)).toHaveLength(1); // the quiet run's line isn't in its history
    expect(getAutomation(a.id).runs.map((r) => r.outcome)).toEqual(["done", "quiet"]);
  });

  it("refuses nothing_new once the run has written to the user", async () => {
    const s = sprocket();
    const a = createAutomation({ name: "Watch", prompt: "Any new PRs?", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    faux.setResponses([script('await tools.send_message({ text: "Looking." }); await tools.nothing_new({ summary: "None" });'), fauxAssistantMessage("Nothing new after all.")]);
    runAutomation(a.id);
    await idle();
    expect(getAutomation(a.id).runs[0].outcome).toBe("done");
  });

  it("needs the user when it asks something; a run while one goes is skipped, and Run now is refused", async () => {
    const s = sprocket();
    const a = createAutomation({ name: "Pick", prompt: "Ask me which report.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    faux.setResponses([script('await tools.ask_user({ question: "Which report?", options: ["Weekly", "Monthly"] });')]);
    runAutomation(a.id);
    expect(() => runAutomation(a.id)).toThrow("It's running now.");
    tick(dueAt(a.id));
    await idle();
    expect(getAutomation(a.id).runs).toMatchObject([
      { trigger: "schedule", outcome: "skipped", summary: "Its previous run hadn't finished." },
      { trigger: "manual", outcome: "needs_you", summary: "Which report?" },
    ]);
  });

  it("turns itself off after failing three times in a row, saying why; turning it on clears that", async () => {
    const s = sprocket();
    const a = createAutomation({ name: "Brief", prompt: "Tell me what's new.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    settings.set("defaultModel", "nowhere/none");
    for (let i = 0; i < 3; i++) {
      runAutomation(a.id);
      await idle();
    }
    const { automation, runs } = getAutomation(a.id);
    expect(runs.map((r) => r.outcome)).toEqual(["failed", "failed", "failed"]);
    expect(runs[0].summary).toContain("nowhere/none isn't available");
    expect(automation.enabled).toBe(false);
    expect(automation.pausedReason).toMatch(/^It failed 3 times in a row\. The last time: The model nowhere\/none/);
    expect(automation.nextRunAt).toBeUndefined();
    const on = updateAutomation(a.id, { enabled: true });
    expect(on.pausedReason).toBeUndefined();
    expect(on.nextRunAt).toBeDefined();
  });

  it("counts only failures in a row", async () => {
    const s = sprocket();
    const a = createAutomation({ name: "Brief", prompt: "Tell me what's new.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    for (const works of [false, false, true, false]) {
      settings.set("defaultModel", works ? ref : "nowhere/none");
      faux.setResponses([fauxAssistantMessage("All quiet.")]);
      runAutomation(a.id);
      await idle();
    }
    expect(getAutomation(a.id).runs.map((r) => r.outcome)).toEqual(["failed", "done", "failed", "failed"]);
    const { automation } = getAutomation(a.id);
    expect(automation).toMatchObject({ enabled: true, stats: { runs: 4, ended: 4, failed: 3, recent: ["failed", "failed", "done", "failed"] } });
    expect(automation.stats.avgMs).toBeGreaterThanOrEqual(0);
  });

  it("needs the user when a tool's call waits on a card", async () => {
    const server = createServer({ name: "autonotes", transport: "stdio", command: process.execPath, args: [fileURLToPath(new URL("../test/fake-mcp.mjs", import.meta.url))] });
    await testServer(server.id);
    const s = sprocket();
    updateSettings(s.id, { tools: { mcp: [server.id] } });
    const a = createAutomation({ name: "Notes", prompt: "Note what's new.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    faux.setResponses([script('await tools.autonotes_add_note({ text: "Call Ada" });'), fauxAssistantMessage("A note waits for you.")]);
    runAutomation(a.id);
    await idle();
    expect(getAutomation(a.id).runs[0].outcome).toBe("needs_you");
  });

  it("turns a once schedule off after it runs, and goes with its Sprocket", async () => {
    const s = sprocket();
    const at = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16); // in an hour, UTC
    const a = createAutomation({ name: "Once", prompt: "Remind me.", sprocketId: s.id, schedule: { kind: "once", at }, timezone: "UTC" });
    faux.setResponses([fauxAssistantMessage("Reminder!")]);
    tick(dueAt(a.id));
    await idle();
    expect(getAutomation(a.id).automation).toMatchObject({ enabled: false });
    expect(getAutomation(a.id).automation.nextRunAt).toBeUndefined();
    // Once its time has passed it can still be renamed, but not turned on again.
    automations.update(a.id, { ...automations.get(a.id)!, schedule: { kind: "once", at: "2020-01-01T09:00" } });
    expect(updateAutomation(a.id, { name: "Once, done" }).name).toBe("Once, done");
    expect(() => updateAutomation(a.id, { enabled: true })).toThrow("That time has passed.");
    deleteSprocket(s.id);
    expect(listAutomations().some((x) => x.id === a.id)).toBe(false);
    const b = createAutomation({ name: "Gone", prompt: "x", sprocketId: sprocket().id, schedule: daily, timezone: "UTC" });
    deleteAutomation(b.id);
    expect(() => getAutomation(b.id)).toThrow("Not found");
  });

  it("leaves nothing behind when firing fails halfway, and tries again on the next tick", async () => {
    const s = sprocket();
    const chat = directChat(s.id);
    const a = createAutomation({ name: "Flaky", prompt: "Check.", sprocketId: s.id, schedule: daily, timezone: "UTC" });
    const at = dueAt(a.id);
    for (const x of automations.list()) if (x.id !== a.id) automations.update(x.id, { ...x, enabled: false }); // earlier tests' are due too
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const original = automationRuns.create.bind(automationRuns);
    const create = vi.spyOn(automationRuns, "create").mockImplementation((run) => {
      if (run.automationId === a.id) throw new Error("disk full");
      return original(run);
    });
    tick(at);
    expect(error).toHaveBeenCalledWith(`automation ${a.id}:`, expect.any(Error));
    expect(listMessages(chat)).toEqual([]);
    expect(sprocketRuns.list(["queued", "running"], chat)).toEqual([]);
    expect(automations.get(a.id)!.nextRunAt).toBe(a.nextRunAt); // still due
    create.mockRestore();
    error.mockRestore();
    faux.setResponses([fauxAssistantMessage("All good.")]);
    tick(at);
    await idle();
    expect(getAutomation(a.id).runs).toMatchObject([{ outcome: "done", summary: "All good." }]);
  });
});
