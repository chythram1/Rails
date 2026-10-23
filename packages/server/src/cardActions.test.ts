// Cards that act (ADR 0031): a Sprocket's calls to ask tools go on a card; the user runs or skips each, and the
// Sprocket goes on once, when all are settled. The same in a direct chat and in a team.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { actOnCard } from "./cardActions.ts";
import { mcpServers, settings, sprocketRuns } from "./db.ts";
import { createServer, disconnectAll, testServer, updateServer } from "./mcp.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, directChat, listMessages, sendMessage, updateSettings } from "./sprockets.ts";
import { createTeam } from "./teams.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "bean", color: "teal", accessory: "none" } as const;
beforeEach(() => settings.set("defaultModel", ref));
afterAll(() => disconnectAll());

const FAKE = fileURLToPath(new URL("./test/fake-mcp.mjs", import.meta.url));
let n = 0;
async function notesServer() {
  const server = createServer({ name: `notes${++n}`, transport: "stdio", command: process.execPath, args: [FAKE] });
  await testServer(server.id);
  return server;
}
const sprocketWith = (name: string, serverId: string) => {
  const s = createSprocket({ name, look });
  updateSettings(s.id, { tools: { mcp: [serverId] } });
  return s;
};
const script = (code: string) => fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
const lastResult = (c: TranscriptContext) => {
  const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
  return r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
};
const seen = (c: TranscriptContext) => JSON.stringify(c.messages);
/** A script that calls these tools, in order. */
const calls = (list: { tool: string; args: unknown }[]) => script(list.map((c) => `await tools.${c.tool}(${JSON.stringify(c.args)});`).join("\n"));
const cardIn = (chat: string) => listMessages(chat).find((m) => m.card?.actions)!;

describe("cards that act", () => {
  it("puts ask tools' calls on one card without running them or ending the turn; a call that doesn't fit makes none", async () => {
    const server = await notesServer();
    const s = sprocketWith("Helper", server.id);
    const chat = directChat(s.id);
    let refused = "";
    faux.setResponses([
      calls([{ tool: `${server.name}_add_note`, args: {} }]),
      (c) => ((refused = lastResult(c)), calls([{ tool: `${server.name}_add_note`, args: { text: "Call Ada" } }])),
      fauxAssistantMessage("Run it when you like."),
    ]);
    sendMessage(chat, "add a note to call Ada");
    await idle();
    expect(refused).toContain("must have required properties text");
    const card = cardIn(chat);
    expect(card.card).toEqual({
      title: `Wants to use ${server.name}`,
      blocks: [],
      actions: [{ label: "Add note", serverId: server.id, server: server.name, tool: "add_note", args: { text: "Call Ada" }, status: "waiting" }],
    });
    expect(listMessages(chat).filter((m) => m.card)).toHaveLength(1);
    expect(listMessages(chat).at(-1)?.text).toBe("Run it when you like."); // the turn went on
    expect(sprocketRuns.list(["waiting"], chat)).toHaveLength(0); // nothing waits in memory
  });

  it("runs and skips them, then gives the Sprocket one turn with what came of each", async () => {
    const server = await notesServer();
    const s = sprocketWith("Helper", server.id);
    const chat = directChat(s.id);
    faux.setResponses([
      calls([
        { tool: `${server.name}_add_note`, args: { text: "Call Ada" } },
        { tool: `${server.name}_add_note`, args: { text: "Email Bo" } },
      ]),
      fauxAssistantMessage("Two notes, ready to add."),
    ]);
    sendMessage(chat, "add notes for Ada and Bo");
    await idle();
    const id = cardIn(chat).id;

    let told = "";
    faux.setResponses([(c) => ((told = seen(c)), fauxAssistantMessage("Added Ada's note; skipped Bo's."))]);
    await actOnCard(id, { index: 0, run: true });
    await idle();
    expect(faux.getPendingResponseCount()).toBe(1); // one still waits: no turn yet
    await expect(actOnCard(id, { index: 0, run: true })).rejects.toThrow("already");
    await actOnCard(id, { index: 1, run: false });
    await idle();
    expect(cardIn(chat).card!.actions!.map((a) => [a.status, a.result])).toEqual([
      ["done", "Added note 2."],
      ["skipped", undefined],
    ]);
    expect(told).toContain("Your user has run or skipped every action on your card");
    expect(told).toContain("Your user ran it. From the MCP server");
    expect(told).toContain("Added note 2.");
    expect(told).toContain("Your user skipped it: it didn't run.");
    expect(listMessages(chat).at(-1)?.text).toBe("Added Ada's note; skipped Bo's.");
    await expect(actOnCard(id, { run: true })).rejects.toThrow("Nothing on it is waiting");
  });

  it("runs all in order, re-checks each at the tap, and lets a message in first see what has run so far", async () => {
    const server = await notesServer();
    const s = sprocketWith("Helper", server.id);
    const chat = directChat(s.id);
    faux.setResponses([
      calls([
        { tool: `${server.name}_add_note`, args: { text: "One" } },
        { tool: `${server.name}_add_note`, args: { text: "Two" } },
        { tool: `${server.name}_clear_notes`, args: {} },
      ]),
      fauxAssistantMessage("Here they are."),
    ]);
    sendMessage(chat, "plan it");
    await idle();
    const id = cardIn(chat).id;
    expect(cardIn(chat).card!.actions![2].destructive).toBe(true);

    // The user writes before running any: that turn sees them waiting.
    let told = "";
    faux.setResponses([(c) => ((told = seen(c)), fauxAssistantMessage("They're still waiting for you."))]);
    sendMessage(chat, "did you add them?");
    await idle();
    expect(told).toContain("Not run yet: your user hasn't run or skipped it.");

    // The tool is turned off before Run all: that one fails; the rest run.
    updateServer(server.id, { policies: { clear_notes: "off" } });
    faux.setResponses([(c) => ((told = seen(c)), fauxAssistantMessage("Added both; clearing is off."))]);
    await actOnCard(id, { run: true });
    await idle();
    expect(cardIn(chat).card!.actions!.map((a) => [a.status, a.result])).toEqual([
      ["done", "Added note 2."],
      ["done", "Added note 3."],
      ["failed", `${server.name} clear_notes isn't available to it any more.`],
    ]);
    expect(told).toContain("Your user ran it, but it failed");
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(mcpServers.get(server.id)).toBeDefined();
  });

  it("in a team, the member that showed the card goes on, outside any round", async () => {
    const server = await notesServer();
    const ada = sprocketWith("Ada", server.id);
    const bo = sprocketWith("Bo", server.id);
    const cy = sprocketWith("Cy", server.id);
    const team = createTeam({ name: "Crew", members: [ada.id, bo.id, cy.id] });
    faux.setResponses([
      fauxAssistantMessage([fauxText("I'll set it up."), fauxToolCall("codemode", { code: `await tools.pass_turn({ to: "Bo", note: "propose the notes" })` })], { stopReason: "toolUse" }),
      calls([{ tool: `${server.name}_add_note`, args: { text: "Standup" } }]),
      fauxAssistantMessage("Run it if it looks right."),
    ]);
    // A message to the whole team: a go-round must not restart when the card settles.
    sendMessage(team.id, "What do you all think we should note?");
    await idle();
    const card = cardIn(team.id);
    expect(card.sprocketId).toBe(bo.id);

    let told = "";
    faux.setResponses([(c) => ((told = seen(c)), fauxAssistantMessage("Added the standup note."))]);
    await actOnCard(card.id, { run: true });
    await idle();
    const last = listMessages(team.id).at(-1)!;
    expect([last.sprocketId, last.text]).toEqual([bo.id, "Added the standup note."]);
    expect(told).toContain("Your user has run or skipped every action on your card");
    expect(told).not.toContain("Your user's message came to you.");
    expect(told).not.toContain("haven't answered yet");
    expect(faux.getPendingResponseCount()).toBe(0); // no reminder, no pass

    // An ask tool called directly by a member @mentioned: its card, and its turn after.
    faux.setResponses([script(`await tools.${server.name}_add_note({ text: "Snacks" })`), fauxAssistantMessage("It's on the card."), (c) => ((told = seen(c)), fauxAssistantMessage("Snacks noted."))]);
    sendMessage(team.id, "@Cy note the snacks");
    await idle();
    const proposed = listMessages(team.id).filter((m) => m.card?.actions).at(-1)!;
    expect([proposed.sprocketId, proposed.card!.title]).toEqual([cy.id, `Wants to use ${server.name}`]);
    await actOnCard(proposed.id, { run: true });
    await idle();
    expect(listMessages(team.id).at(-1)).toMatchObject({ sprocketId: cy.id, text: "Snacks noted." });
  });
});
