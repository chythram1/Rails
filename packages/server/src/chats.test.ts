// Sprocket chats (ADR 0021): a direct chat per Sprocket, a project chat per attached one.
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { RAILS_HOME } from "./config.ts";
import { assignChats, panels, projects, settings, sprocketMessages, sprockets, suggestions } from "./db.ts";
import { models, refOf } from "./models.ts";
import { idle, isRunning } from "./runs.ts";
import { clearChat, createSprocket, deleteSprocket, directChat, listMessages, listSprockets, postEvent, projectChat, sendMessage, updateSettings } from "./sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "cog", color: "green", accessory: "none" } as const;
beforeEach(() => settings.set("defaultModel", ref));

let n = 0;
function coordinator() {
  const s = createSprocket({ name: `Lead ${++n}`, look });
  const p = projects.create("app", `/work/chats-${n}`);
  updateSettings(s.id, { projectId: p.id });
  const panel = panels.create({ projectId: p.id, kind: "claude", title: "API" });
  return { s, p, panel };
}
const event = (panelId: string) => ({ panelId, kind: "claude" as const, title: "API", what: "turn_end" as const });
const texts = (chatId: string) => listMessages(chatId).map((m) => `${m.author}: ${m.text}`);
/** The text of every message a scripted model call was given. */
const seen = (c: TranscriptContext) => c.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""))).join("\n");

describe("chats", () => {
  it("gives every Sprocket a direct chat, and an attached one its project's chat", () => {
    const s = createSprocket({ name: "Solo", look });
    const shown = listSprockets().find((x) => x.id === s.id)!;
    expect(shown.direct.id).toBe(directChat(s.id));
    expect(shown.projectChat).toBeUndefined();
    expect(() => projectChat(s.id)).toThrow();

    const p = projects.create("app", "/work/chats-solo");
    updateSettings(s.id, { projectId: p.id });
    expect(listSprockets().find((x) => x.id === s.id)!.projectChat?.id).toBe(projectChat(s.id));
  });

  it("puts Rails' events in the project chat only, and the user's messages where they're sent", async () => {
    const { s, panel } = coordinator();
    faux.setResponses([fauxAssistantMessage("Noted."), fauxAssistantMessage("API asks whether to merge.")]);
    sendMessage(directChat(s.id), "hello");
    await idle();
    postEvent(s.id, event(panel.id), "Shall I merge?");
    await idle();
    expect(texts(directChat(s.id))).toEqual(["user: hello", "sprocket: Noted."]);
    expect(texts(projectChat(s.id))).toEqual(["event: Shall I merge?", "sprocket: API asks whether to merge."]);
    expect(listSprockets().find((x) => x.id === s.id)!.direct.lastMessage?.text).toBe("Noted.");
  });

  it("runs each chat on its own history", async () => {
    const { s, panel } = coordinator();
    const contexts: string[] = [];
    const reply = (text: string) => (c: TranscriptContext) => (contexts.push(seen(c)), fauxAssistantMessage(text));
    faux.setResponses([reply("Seen it."), reply("Hi.")]);
    postEvent(s.id, event(panel.id), "Shall I merge?");
    await idle();
    sendMessage(directChat(s.id), "what's new?");
    await idle();
    expect(contexts[1]).toContain("what's new?");
    expect(contexts[1]).not.toContain("Shall I merge?");
    expect(contexts[1]).not.toContain("Seen it.");
  });

  it("answers one chat at a time, then the other", async () => {
    const { s, panel } = coordinator();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, fauxAssistantMessage("Direct reply.")), fauxAssistantMessage("Project reply.")]);
    sendMessage(directChat(s.id), "hi");
    postEvent(s.id, event(panel.id), "Shall I merge?");
    await new Promise((r) => setTimeout(r, 20));
    const shown = listSprockets().find((x) => x.id === s.id)!;
    expect([shown.direct.running, shown.projectChat?.running]).toEqual([true, false]);
    release();
    await idle();
    expect(isRunning(s.id)).toBe(false);
    expect(texts(directChat(s.id)).at(-1)).toBe("sprocket: Direct reply.");
    expect(texts(projectChat(s.id)).at(-1)).toBe("sprocket: Project reply.");
  });

  it("lets the direct chat read the project chat when asked", async () => {
    const { s, panel } = coordinator();
    faux.setResponses([fauxAssistantMessage("(quiet)")]);
    postEvent(s.id, event(panel.id), "Shall I merge?");
    await idle();
    let tools = "";
    faux.setResponses([
      (c) => ((tools = JSON.stringify(c.messages)), fauxAssistantMessage([fauxToolCall("codemode", { code: "return await tools.project_chat({})" })], { stopReason: "toolUse" })),
      (c) => fauxAssistantMessage(seen(c).includes("Shall I merge?") ? "API asked whether to merge." : "Nothing there."),
    ]);
    sendMessage(directChat(s.id), "what did I miss?");
    await idle();
    expect(tools).toContain("project_chat");
    expect(texts(directChat(s.id)).at(-1)).toBe("sprocket: API asked whether to merge.");

    // Not in the project chat itself, nor for a Sprocket with no project.
    faux.setResponses([(c) => ((tools = JSON.stringify(c.messages)), fauxAssistantMessage("Ok."))]);
    sendMessage(projectChat(s.id), "and here?");
    await idle();
    expect(tools).not.toContain("project_chat");
  });

  it("clears a chat: its messages go, its waiting suggestions expire, the Sprocket's memory stays", async () => {
    const { s, panel } = coordinator();
    sprockets.setCoreMemory(s.id, "Likes short answers.");
    faux.setResponses([fauxAssistantMessage("Ok.")]);
    sendMessage(projectChat(s.id), "hi");
    await idle();
    const reply = listMessages(projectChat(s.id)).at(-1)!;
    const draft = suggestions.create({ sprocketId: s.id, panelId: panel.id, kind: "claude", title: "API", mode: "message", text: "Merge it." });
    suggestions.attach([draft.id], reply.id);
    sendMessage(directChat(s.id), "keep this");
    await idle();

    clearChat(projectChat(s.id));
    expect(listMessages(projectChat(s.id))).toEqual([]);
    expect(suggestions.get(draft.id)).toMatchObject({ status: "expired", error: "The chat was cleared." });
    expect(sprockets.get(s.id)!.coreMemory).toBe("Likes short answers.");
    expect(texts(directChat(s.id))[0]).toBe("user: keep this");
  });

  it("drops a reply that was being written when its chat was cleared", async () => {
    const s = createSprocket({ name: "Slow", look });
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, fauxAssistantMessage("Too late."))]);
    sendMessage(directChat(s.id), "hi");
    await new Promise((r) => setTimeout(r, 20));
    clearChat(directChat(s.id));
    release();
    await idle();
    expect(listMessages(directChat(s.id))).toEqual([]);
  });

  it("deletes the project chat when the Sprocket moves, and keeps its direct chat", async () => {
    const { s, panel } = coordinator();
    faux.setResponses([fauxAssistantMessage("Hi."), fauxAssistantMessage("Seen.")]);
    sendMessage(directChat(s.id), "hello");
    await idle();
    postEvent(s.id, event(panel.id), "Shall I merge?");
    await idle();
    const old = projectChat(s.id);
    updateSettings(s.id, { projectId: null });
    expect(texts(directChat(s.id))).toEqual(["user: hello", "sprocket: Hi."]);
    expect(() => listMessages(old)).toThrow("Not found");
    deleteSprocket(s.id);
    expect(() => listMessages(directChat(s.id))).toThrow();
  });

  it("refuses unknown chats", () => {
    expect(() => listMessages("nope")).toThrow("Not found");
    expect(() => sendMessage("nope", "hi")).toThrow("Not found");
    expect(() => clearChat("nope")).toThrow("Not found");
  });

  it("files the messages of a chat made before chats into the right one", () => {
    const db = new DatabaseSync(join(RAILS_HOME, "rails.db"));
    const solo = sprockets.create("Old solo", look);
    const lead = sprockets.create("Old lead", look);
    const p = projects.create("old", "/work/chats-old");
    db.prepare("UPDATE sprockets SET project_id = ?, coordinator = 1 WHERE id = ?").run(p.id, lead.id);
    db.prepare("DELETE FROM sprocket_chats WHERE sprocket_id IN (?, ?)").run(solo.id, lead.id);
    for (const id of [solo.id, lead.id])
      db.prepare("INSERT INTO sprocket_messages (id, sprocket_id, author, text, created_at) VALUES (?, ?, 'user', 'before', ?)").run(`old-${id}`, id, new Date().toISOString());
    db.close();
    assignChats();
    expect(sprocketMessages.list(directChat(solo.id)).map((m) => m.text)).toEqual(["before"]);
    expect(sprocketMessages.list(projectChat(lead.id)).map((m) => m.text)).toEqual(["before"]);
    expect(sprocketMessages.list(directChat(lead.id))).toEqual([]);
  });
});
