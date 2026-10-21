// Group chats (ADR 0022): the user and two to four Sprockets. The lead answers unless someone is @mentioned, a
// reply passes the turn on by mentioning, and a round stops after 6 turns.
import { fauxAssistantMessage, fauxProvider, type TranscriptContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { projects, settings, sprockets } from "./db.ts";
import { createGroup, deleteGroup, listGroups, updateGroup } from "./groupChats.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { clearChat, createSprocket, deleteSprocket, listMessages, sendMessage, updateSettings } from "./sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "cog", color: "green", accessory: "none" } as const;
beforeEach(() => settings.set("defaultModel", ref));

const sprocket = (name: string) => createSprocket({ name, look });
/** Ada, Bo and Cy in a group called Crew, Ada leading. */
function crew(names = ["Ada", "Bo", "Cy"]) {
  const members = names.map(sprocket);
  return { members, group: createGroup({ name: "Crew", members: members.map((m) => m.id) }) };
}
/** The chat as the user reads it: who wrote each message. */
const said = (chatId: string) =>
  listMessages(chatId).map((m) => `${m.author === "sprocket" ? (sprockets.get(m.sprocketId)?.name ?? "deleted") : m.author}: ${m.text}`);
/** Everything a scripted model call was given, the system prompt first. */
const seen = (c: TranscriptContext) => c.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""))).join("\n");
const reply = (text: string) => fauxAssistantMessage(text);

describe("group chats", () => {
  it("makes a group of two to four Sprockets with different names, the first its lead", () => {
    const [a, b, c, d, e] = ["Ada", "Bo", "Cy", "Di", "Ed"].map(sprocket);
    expect(() => createGroup({ name: "Crew", members: [a.id] })).toThrow(/two/);
    expect(() => createGroup({ name: "Crew", members: [a.id, b.id, c.id, d.id, e.id] })).toThrow(/four/);
    expect(() => createGroup({ name: " ", members: [a.id, b.id] })).toThrow(/name/);
    expect(() => createGroup({ name: "Crew", members: [a.id, "nobody"] })).toThrow();
    expect(() => createGroup({ name: "Crew", members: [a.id, a.id] })).toThrow();
    expect(() => createGroup({ name: "Crew", members: [a.id, sprocket("ada").id] })).toThrow(/ada/i);

    const g = createGroup({ name: " Crew ", members: [b.id, a.id] });
    expect(listGroups().find((x) => x.id === g.id)).toMatchObject({ kind: "group", name: "Crew", members: [b.id, a.id], running: false, pending: 0 });
    updateGroup(g.id, { name: "Team", members: [c.id, b.id, a.id] });
    expect(listGroups().find((x) => x.id === g.id)).toMatchObject({ name: "Team", members: [c.id, b.id, a.id] });
  });

  it("sends the user's message to the lead, and a reply passes the turn on by @mention", async () => {
    const { group } = crew();
    faux.setResponses([reply("The engine's done. @Bo, are the docs behind?"), reply("Two pages are.")]);
    sendMessage(group.id, "What should we do next?");
    await idle();
    expect(said(group.id)).toEqual(["user: What should we do next?", "Ada: The engine's done. @Bo, are the docs behind?", "Bo: Two pages are."]);
    expect(listGroups().find((x) => x.id === group.id)?.lastMessage?.text).toBe("Two pages are.");
  });

  it("lets the user pick who answers, in the order they're mentioned", async () => {
    const { group } = crew(["Ada", "Doc Keeper", "Cy"]);
    faux.setResponses([reply("Cy here."), reply("Doc here.")]);
    sendMessage(group.id, "@Cy and @doc keeper, thoughts? (@Zed isn't here)");
    await idle();
    expect(said(group.id).slice(1)).toEqual(["Cy: Cy here.", "Doc Keeper: Doc here."]);
  });

  it("stops a round after 6 turns and says so; the user's next message starts another", async () => {
    const { group } = crew(["Ada", "Bo"]);
    faux.setResponses(Array.from({ length: 6 }, (_, i) => reply(i % 2 ? `@Ada over to you (${i})` : `@Bo over to you (${i})`)));
    sendMessage(group.id, "Talk it over.");
    await idle();
    const messages = said(group.id);
    expect(messages.filter((m) => !m.startsWith("user") && !m.startsWith("notice"))).toHaveLength(6);
    expect(messages.at(-1)).toMatch(/^notice: .*6/);

    faux.setResponses([reply("Back to you.")]);
    sendMessage(group.id, "Ada, sum up.");
    await idle();
    expect(said(group.id).at(-1)).toBe("Ada: Back to you.");
  });

  it("shows a member the others' replies by name, its own as its own, and the group in its instructions", async () => {
    const { group } = crew();
    faux.setResponses([reply("@Bo, your turn."), reply("Bo's first.")]);
    sendMessage(group.id, "Start.");
    await idle();
    let context: TranscriptContext | undefined;
    faux.setResponses([(c) => ((context = c), reply("Bo's second."))]);
    sendMessage(group.id, "@Bo again.");
    await idle();
    const text = seen(context!);
    expect(text).toContain('"Crew"');
    expect(text).toMatch(/Ada \(lead\)/);
    expect(text).toContain("[Ada] @Bo, your turn.");
    const own = context!.messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(own)).toContain("Bo's first.");
  });

  it("replaces the turns still waiting when the user writes during a round", async () => {
    const { group } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("@Bo @Cy over to you.")), reply("Cy only.")]);
    sendMessage(group.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    sendMessage(group.id, "@Cy just you, please.");
    release();
    await idle();
    expect(said(group.id)).toEqual(["user: Go.", "Ada: @Bo @Cy over to you.", "user: @Cy just you, please.", "Cy: Cy only."]);
  });

  it("stops a round when the chat is cleared", async () => {
    const { group } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("@Bo yours.")), reply("Bo should not answer.")]);
    sendMessage(group.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    clearChat(group.id);
    release();
    await idle();
    expect(said(group.id)).toEqual([]);
  });

  it("gives each member the tools of its direct chat", async () => {
    const { members, group } = crew(["Ada", "Bo"]);
    updateSettings(members[0].id, { projectId: projects.create("app", "/work/group-tools").id });
    const tools: string[] = [];
    faux.setResponses([(c) => (tools.push(JSON.stringify(c.messages[0])), reply("@Bo yours.")), (c) => (tools.push(JSON.stringify(c.messages[0])), reply("Ok."))]);
    sendMessage(group.id, "Go.");
    await idle();
    expect(tools[0]).toContain("project_board");
    expect(tools[0]).toContain("project_chat");
    expect(tools[1]).not.toContain("project_board");
  });

  it("takes a deleted Sprocket out of its groups, hands the lead on, and keeps what it wrote", async () => {
    const { members, group } = crew();
    const [a, b, c] = members;
    faux.setResponses([reply("Ada was here.")]);
    sendMessage(group.id, "Hi.");
    await idle();
    deleteSprocket(a.id);
    expect(listGroups().find((x) => x.id === group.id)?.members).toEqual([b.id, c.id]);
    expect(said(group.id)).toEqual(["user: Hi.", "deleted: Ada was here."]);

    faux.setResponses([reply("Bo leads now.")]);
    sendMessage(group.id, "Who's there?");
    await idle();
    expect(said(group.id).at(-1)).toBe("Bo: Bo leads now.");

    deleteSprocket(b.id);
    deleteSprocket(c.id);
    expect(listGroups().some((x) => x.id === group.id)).toBe(false);
  });

  it("deletes a group with its chat, and leaves its members alone", () => {
    const { members, group } = crew();
    deleteGroup(group.id);
    expect(listGroups().some((x) => x.id === group.id)).toBe(false);
    expect(() => listMessages(group.id)).toThrow();
    expect(sprockets.get(members[0].id)).toBeDefined();
  });
});
