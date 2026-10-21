// Team chats (ADR 0022): the user and two to four Sprockets. The user's message goes to those it @mentions, else to
// those it's for (the decision model, or Rails' rules), else the lead; a reply passes the turn on by mentioning, and
// a round stops after TEAM_TURNS_MAX turns.
import { fauxAssistantMessage, fauxProvider, type ClassifierContext, type ClassifierResult, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { TEAM_TURNS_MAX } from "@rails/shared";
import { projects, settings, sprockets } from "./db.ts";
import { askedByName, createTeam, deleteTeam, listTeams, mentioned, updateTeam } from "./teams.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { clearChat, createSprocket, deleteSprocket, listMessages, sendMessage, updateSettings } from "./sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
/** A scripted decision model: who a message is for. */
let judged: (context: ClassifierContext) => Partial<ClassifierResult> = () => ({});
let gate: Promise<void> = Promise.resolve();
const judge: Provider = {
  ...faux.provider,
  id: "judge",
  name: "Judge",
  getModels: () => [],
  getAllModels: () => [{ type: "classifier", id: "judge-1", name: "Judge", api: "judge", provider: "judge", baseUrl: "", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000 }] as never,
  classify: async (_model, context) => {
    await gate;
    return { api: "judge", provider: "judge", model: "judge-1", answers: {}, stopReason: "stop", timestamp: Date.now(), ...judged(context) };
  },
};
models.setProvider(judge);
const look = { character: "cog", color: "green", accessory: "none" } as const;
beforeEach(() => {
  settings.set("defaultModel", ref);
  settings.set("decisionModel", null);
  gate = Promise.resolve();
});
/** Once Rails knows who answers the user's message and every reply is in. */
async function settled() {
  while (listTeams().some((t) => t.routing)) await new Promise((r) => setTimeout(r, 5));
  await idle();
}

const sprocket = (name: string) => createSprocket({ name, look });
/** Ada, Bo and Cy in a team called Crew, Ada leading. */
function crew(names = ["Ada", "Bo", "Cy"]) {
  const members = names.map(sprocket);
  return { members, team: createTeam({ name: "Crew", members: members.map((m) => m.id) }) };
}
/** The chat as the user reads it: who wrote each message. */
const said = (chatId: string) =>
  listMessages(chatId).map((m) => `${m.author === "sprocket" ? (sprockets.get(m.sprocketId)?.name ?? "deleted") : m.author}: ${m.text}`);
/** Everything a scripted model call was given, the system prompt first. */
const seen = (c: TranscriptContext) => c.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""))).join("\n");
const reply = (text: string) => fauxAssistantMessage(text);
const crewIds = (team: { members: string[] }) => team.members;

describe("team chats", () => {
  it("makes a team of two to four Sprockets with different names, the first its lead", () => {
    const [a, b, c, d, e] = ["Ada", "Bo", "Cy", "Di", "Ed"].map(sprocket);
    expect(() => createTeam({ name: "Crew", members: [a.id] })).toThrow(/two/);
    expect(() => createTeam({ name: "Crew", members: [a.id, b.id, c.id, d.id, e.id] })).toThrow(/four/);
    expect(() => createTeam({ name: " ", members: [a.id, b.id] })).toThrow(/name/);
    expect(() => createTeam({ name: "Crew", members: [a.id, "nobody"] })).toThrow();
    expect(() => createTeam({ name: "Crew", members: [a.id, a.id] })).toThrow();
    expect(() => createTeam({ name: "Crew", members: [a.id, sprocket("ada").id] })).toThrow(/ada/i);

    const g = createTeam({ name: " Crew ", members: [b.id, a.id] });
    expect(listTeams().find((x) => x.id === g.id)).toMatchObject({ kind: "team", name: "Crew", members: [b.id, a.id], running: false, pending: 0 });
    updateTeam(g.id, { name: "Team", members: [c.id, b.id, a.id] });
    expect(listTeams().find((x) => x.id === g.id)).toMatchObject({ name: "Team", members: [c.id, b.id, a.id] });
  });

  it("sends the user's message to the lead, and a reply passes the turn on by @mention", async () => {
    const { team } = crew();
    faux.setResponses([reply("The engine's done. @Bo, are the docs behind?"), reply("Two pages are.")]);
    sendMessage(team.id, "What should we do next?");
    await idle();
    expect(said(team.id)).toEqual(["user: What should we do next?", "Ada: The engine's done. @Bo, are the docs behind?", "Bo: Two pages are."]);
    expect(listTeams().find((x) => x.id === team.id)?.lastMessage?.text).toBe("Two pages are.");
  });

  it("reads @mentions: whole names first, the start of just one member's name, never inside a word", () => {
    const m = [
      { id: "d", name: "Doc Keeper" },
      { id: "o", name: "Doc" },
      { id: "p", name: "Pixel" },
      { id: "q", name: "Pip" },
    ];
    expect(mentioned("@Doc Keeper and @doc", m)).toEqual(["d", "o"]);
    expect(mentioned("@kee, then @pix", m)).toEqual(["d", "p"]);
    expect(mentioned("@pi or @p or mail me@pixel.com", m)).toEqual([]); // two fit, one letter, inside a word
  });

  it("without an @, sends the message to the members it names, everyone, the one who asked, or else the lead", async () => {
    const { team } = crew();
    faux.setResponses([reply("Docs first.")]);
    sendMessage(team.id, "Bo, what do you think?");
    await settled();
    faux.setResponses([reply("A."), reply("B."), reply("C.")]);
    sendMessage(team.id, "One idea from everyone, please");
    await settled();
    faux.setResponses([reply("Want me to write it up?")]);
    sendMessage(team.id, "@Cy any risks?");
    await settled();
    faux.setResponses([reply("Done.")]);
    sendMessage(team.id, "yes please");
    await settled();
    faux.setResponses([reply("Shipping.")]);
    sendMessage(team.id, "What's next?");
    await settled();
    expect(said(team.id).filter((l) => !l.startsWith("user"))).toEqual(["Bo: Docs first.", "Ada: A.", "Bo: B.", "Cy: C.", "Cy: Want me to write it up?", "Cy: Done.", "Ada: Shipping."]);
  });

  it("asks the decision model who a message without @ is for, and uses the rules when it fails", async () => {
    const { team } = crew();
    settings.set("decisionModel", "judge/judge-1");
    let asked: ClassifierContext | undefined;
    let open = () => {};
    gate = new Promise((r) => (open = r));
    judged = (c) => {
      if ("member_0" in c.questions) asked = c;
      return { answers: { member_0: { type: "bool", probability: 0.2 }, member_1: { type: "bool", probability: 0.9 }, member_2: { type: "bool", probability: 0.55 } } };
    };
    faux.setResponses([reply("On it.")]);
    sendMessage(team.id, "Can someone check the docs?");
    // Everyone sees it while the model judges; then only Bo answers (Cy is below the bar).
    expect(listTeams().find((t) => t.id === team.id)).toMatchObject({ routing: true, waiting: [] });
    open();
    await settled();
    expect(Object.keys(asked!.questions)).toEqual(["member_0", "member_1", "member_2"]);
    expect(asked!.state).toMatchObject({ new_message_from_user: "Can someone check the docs?" });
    judged = () => ({ stopReason: "error", errorMessage: "down" });
    faux.setResponses([reply("Here.")]);
    sendMessage(team.id, "And the tests?");
    await settled();
    expect(said(team.id)).toEqual(["user: Can someone check the docs?", "Bo: On it.", "user: And the tests?", "Ada: Here."]);
    // With an @mention, the mentioned answer first, and the model may add others the message is clearly for.
    judged = () => ({ answers: { member_0: { type: "bool", probability: 0.1 }, member_1: { type: "bool", probability: 0.9 }, member_2: { type: "bool", probability: 0.8 } } });
    faux.setResponses([reply("Yes."), reply("Also yes.")]);
    sendMessage(team.id, "@Bo and Cy: ready?");
    await settled();
    expect(said(team.id).slice(-2)).toEqual(["Bo: Yes.", "Cy: Also yes."]);
  });

  it("passes the turn to a member a reply asks by name, as with an @mention", async () => {
    const { team } = crew();
    faux.setResponses([reply("Light first. Bo, what would you ship?"), reply("Both, small. Agreed, Ada?"), reply("Agreed.")]);
    sendMessage(team.id, "Dark mode at launch?");
    await settled();
    expect(said(team.id).slice(1)).toEqual(["Ada: Light first. Bo, what would you ship?", "Bo: Both, small. Agreed, Ada?", "Ada: Agreed."]);
    expect(askedByName("Bo said so. Ask Cy? Bo, really. Cy: ready?", [{ id: "b", name: "Bo" }, { id: "c", name: "Cy" }])).toEqual(["c"]);
  });

  it("ends a round when a reply @mentions no one, without asking the decision model", async () => {
    const { team } = crew(["Fred", "Bobi", "Pam"]);
    settings.set("decisionModel", "judge/judge-1");
    let asked = 0;
    judged = () => (asked++, { answers: { member_0: { type: "bool", probability: 0.9 }, member_1: { type: "bool", probability: 0.1 }, member_2: { type: "bool", probability: 0.1 } } });
    let note = "";
    faux.setResponses([(c) => ((note = seen(c).split("\n").slice(-3).join("\n")), reply("Hi Pam and Bobi!")), reply("Not reached.")]);
    sendMessage(team.id, "Fred, say hello to your new team");
    await settled();
    expect(said(team.id).slice(1)).toEqual(["Fred: Hi Pam and Bobi!"]);
    expect(asked).toBe(1); // the user's message only
    expect(note).toMatch(/latest message: "Fred, say hello to your new team"\. Replies since it: 0; yours is reply 1/);
    expect(note).toMatch(/Write @Name for every teammate you want an answer from/);

    faux.setResponses([reply("Hi @Pam and @Bobi!"), reply("Welcome, Fred!"), reply("Hi Fred!")]);
    sendMessage(team.id, "Fred, try again");
    await settled();
    expect(said(team.id).slice(-3)).toEqual(["Fred: Hi @Pam and @Bobi!", "Pam: Welcome, Fred!", "Bobi: Hi Fred!"]);
  });

  it("drops a member's own name from the front of its reply", async () => {
    const { team } = crew();
    faux.setResponses([reply("[Ada] Sure. @Bo?"), reply("**Bo:** Yes.")]);
    sendMessage(team.id, "Ready?");
    await settled();
    expect(said(team.id)).toEqual(["user: Ready?", "Ada: Sure. @Bo?", "Bo: Yes."]);
  });

  it("lets the user pick who answers, in the order they're mentioned, the lead first", async () => {
    const { team } = crew(["Ada", "Doc Keeper", "Cy"]);
    faux.setResponses([reply("Cy here."), reply("Doc here.")]);
    sendMessage(team.id, "@Cy and @doc keeper, thoughts? (@Zed isn't here)");
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Cy: Cy here.", "Doc Keeper: Doc here."]);

    faux.setResponses([reply("Ada first."), reply("Cy second.")]);
    sendMessage(team.id, "@Cy and @Ada?");
    await idle();
    expect(said(team.id).slice(-2)).toEqual(["Ada: Ada first.", "Cy: Cy second."]);
  });

  it("shows whose turns are coming, and puts the lead ahead when a reply mentions it", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("@Cy @Ada over to you.")), reply("Ada."), reply("Cy.")]);
    sendMessage(team.id, "@Bo go.");
    await new Promise((r) => setTimeout(r, 20));
    expect(listTeams().find((x) => x.id === team.id)).toMatchObject({ replying: crewIds(team)[1], waiting: [] });
    release();
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Bo: @Cy @Ada over to you.", "Ada: Ada.", "Cy: Cy."]);
    expect(listTeams().find((x) => x.id === team.id)?.waiting).toEqual([]);
  });

  it("stops a round after TEAM_TURNS_MAX turns and says so; the user's next message starts another", async () => {
    const { team } = crew(["Ada", "Bo"]);
    faux.setResponses(Array.from({ length: TEAM_TURNS_MAX }, (_, i) => reply(i % 2 ? `@Ada over to you (${i})` : `@Bo over to you (${i})`)));
    sendMessage(team.id, "Talk it over.");
    await idle();
    const messages = said(team.id);
    expect(messages.filter((m) => !m.startsWith("user") && !m.startsWith("notice"))).toHaveLength(TEAM_TURNS_MAX);
    expect(messages.at(-1)).toMatch(new RegExp(`^notice: .*${TEAM_TURNS_MAX}`));

    faux.setResponses([reply("Back to you.")]);
    sendMessage(team.id, "Ada, sum up.");
    await idle();
    expect(said(team.id).at(-1)).toBe("Ada: Back to you.");
  });

  it("shows a member the others' replies by name, its own as its own, and the team in its instructions", async () => {
    const { team } = crew();
    faux.setResponses([reply("@Bo, your turn."), reply("Bo's first.")]);
    sendMessage(team.id, "Start.");
    await idle();
    let context: TranscriptContext | undefined;
    faux.setResponses([(c) => ((context = c), reply("Bo's second."))]);
    sendMessage(team.id, "@Bo again.");
    await idle();
    const text = seen(context!);
    expect(text).toContain('"Crew"');
    expect(text).toMatch(/Ada \(lead\)/);
    expect(text).toContain("[Ada] @Bo, your turn.");
    const own = context!.messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(own)).toContain("Bo's first.");
  });

  it("replaces the turns still waiting when the user writes during a round", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("@Bo @Cy over to you.")), reply("Cy only.")]);
    sendMessage(team.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    sendMessage(team.id, "@Cy just you, please.");
    release();
    await idle();
    expect(said(team.id)).toEqual(["user: Go.", "Ada: @Bo @Cy over to you.", "user: @Cy just you, please.", "Cy: Cy only."]);
  });

  it("stops a round when the chat is cleared", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("@Bo yours.")), reply("Bo should not answer.")]);
    sendMessage(team.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    clearChat(team.id);
    release();
    await idle();
    expect(said(team.id)).toEqual([]);
  });

  it("gives each member the tools of its direct chat", async () => {
    const { members, team } = crew(["Ada", "Bo"]);
    updateSettings(members[0].id, { projectId: projects.create("app", "/work/team-tools").id });
    const tools: string[] = [];
    faux.setResponses([(c) => (tools.push(JSON.stringify(c.messages[0])), reply("@Bo yours.")), (c) => (tools.push(JSON.stringify(c.messages[0])), reply("Ok."))]);
    sendMessage(team.id, "Go.");
    await idle();
    expect(tools[0]).toContain("project_board");
    expect(tools[0]).toContain("project_chat");
    expect(tools[1]).not.toContain("project_board");
  });

  it("takes a deleted Sprocket out of its teams, hands the lead on, and keeps what it wrote", async () => {
    const { members, team } = crew();
    const [a, b, c] = members;
    faux.setResponses([reply("Ada was here.")]);
    sendMessage(team.id, "Hi.");
    await idle();
    deleteSprocket(a.id);
    expect(listTeams().find((x) => x.id === team.id)?.members).toEqual([b.id, c.id]);
    expect(said(team.id)).toEqual(["user: Hi.", "deleted: Ada was here."]);

    faux.setResponses([reply("Bo leads now.")]);
    sendMessage(team.id, "Who's there?");
    await idle();
    expect(said(team.id).at(-1)).toBe("Bo: Bo leads now.");

    deleteSprocket(b.id);
    deleteSprocket(c.id);
    expect(listTeams().some((x) => x.id === team.id)).toBe(false);
  });

  it("deletes a team with its chat, and leaves its members alone", () => {
    const { members, team } = crew();
    deleteTeam(team.id);
    expect(listTeams().some((x) => x.id === team.id)).toBe(false);
    expect(() => listMessages(team.id)).toThrow();
    expect(sprockets.get(members[0].id)).toBeDefined();
  });
});
