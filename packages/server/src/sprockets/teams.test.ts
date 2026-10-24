// Team chats (ADR 0022, 0033): the user and two to four Sprockets. Every message wakes every member at once (or only
// those it @mentions, or for a tapped option whoever asked), and each decides whether to write or stay (quiet). A
// member's message wakes the others, at most TEAM_TURNS_MAX levels after the user's message.
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { TEAM_TURNS_MAX } from "@rails/shared";
import { projects, settings, sprocketRuns, sprockets } from "../db.ts";
import { createTeam, deleteTeam, listTeams, mentioned, updateTeam } from "./teams.ts";
import { models, refOf } from "../settings/models.ts";
import { waitingAsks } from "./members.ts";
import { idle } from "./runs.ts";
import { clearChat, createSprocket, deleteSprocket, listMessages, sendMessage, updateSettings } from "./sprockets.ts";
import { scriptMembers, seen } from "../test/members.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "cog", color: "green" } as const;
beforeEach(() => settings.set("defaultModel", ref));

const sprocket = (name: string) => createSprocket({ name, look });
/** Ada, Bo and Cy in a team called Crew. */
function crew(names = ["Ada", "Bo", "Cy"]) {
  const members = names.map(sprocket);
  return { members, team: createTeam({ name: "Crew", members: members.map((m) => m.id) }) };
}
/** The chat as the user reads it: who wrote each message. */
const nameOf = (id: string | undefined) => (id && sprockets.get(id)?.name) || "deleted";
const said = (chatId: string) => listMessages(chatId).map((m) => `${m.author === "sprocket" ? nameOf(m.sprocketId) : m.author}: ${m.text}`);
/** Messages from members, in any order (members run at once). */
const fromMembers = (chatId: string) => said(chatId).filter((l) => !l.startsWith("user:")).sort();
const reply = (text: string) => fauxAssistantMessage(text);
/** A question with options (ask_user; its run waits). */
const ask = (question: string, options: string[]) =>
  fauxAssistantMessage([fauxToolCall("codemode", { code: `await tools.ask_user(${JSON.stringify({ question, options })})` })], { stopReason: "toolUse" });
const gate = () => {
  let open = () => {};
  const shut = new Promise<void>((r) => (open = r));
  return { open, wait: shut };
};
const until = async (test: () => boolean) => {
  for (let i = 0; i < 200 && !test(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe("team chats", () => {
  it("makes a team of two to four Sprockets with different names, in order", () => {
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


  it("wakes every member on the user's message; those with nothing to add stay quiet and post nothing", async () => {
    const { team } = crew();
    const calls = scriptMembers(faux, { Bo: [reply("The cash floor is $50,000.")] });
    sendMessage(team.id, "Bo, what's our cash floor?");
    await idle();
    expect(said(team.id)).toEqual(["user: Bo, what's our cash floor?", "Bo: The cash floor is $50,000."]);
    // Everyone read it (Ada and Cy once for the user, once more for Bo's answer), and nothing in code picked Bo.
    expect(calls).toEqual({ Ada: 2, Bo: 1, Cy: 2 });
    expect(listMessages(team.id).some((m) => m.author === "notice")).toBe(false);
  });

  it("takes a short form of (quiet) as quiet too, as some models write it", async () => {
    const { team } = crew();
    scriptMembers(faux, { Ada: [reply("Ada here.")], Bo: [reply("(q)"), reply("(Ada's answer covers it)")], Cy: [reply("(Long aside: this whole message is in brackets but it says something real to the team.)")] });
    sendMessage(team.id, "Ada?");
    await idle();
    expect(said(team.id)).toEqual(["user: Ada?", "Ada: Ada here.", "Cy: (Long aside: this whole message is in brackets but it says something real to the team.)"]);
  });

  it("lets every member answer a message for all of them, at once", async () => {
    const { team } = crew();
    const g = gate();
    const both = async (text: string) => (await g.wait, reply(text));
    scriptMembers(faux, { Ada: [() => both("Ada's take.")], Bo: [() => both("Bo's take.")], Cy: [() => both("Cy's take.")] });
    sendMessage(team.id, "Thoughts, both of you and Cy?");
    await until(() => (listTeams().find((t) => t.id === team.id)?.replying.length ?? 0) === 3);
    expect(listTeams().find((t) => t.id === team.id)?.replying.map(nameOf).sort()).toEqual(["Ada", "Bo", "Cy"]);
    g.open();
    await idle();
    expect(fromMembers(team.id)).toEqual(["Ada: Ada's take.", "Bo: Bo's take.", "Cy: Cy's take."]);
  });

  it("wakes only the members an @mention names", async () => {
    const { team } = crew();
    const calls = scriptMembers(faux, { Cy: [reply("Cy here.")] });
    sendMessage(team.id, "@Cy any risks?");
    await idle();
    expect(said(team.id)).toEqual(["user: @Cy any risks?", "Cy: Cy here."]);
    expect(calls.Cy).toBe(1);
    expect((calls.Ada ?? 0) + (calls.Bo ?? 0)).toBe(2); // they read Cy's answer, not yours
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


  it("lets a member ask a teammate in the chat, who answers without the user writing again", async () => {
    const { team } = crew(["Chandler", "Becky"]);
    let becky = "";
    scriptMembers(faux, {
      Chandler: [reply("Becky, cheapest test?")],
      Becky: [reply("(quiet)"), (c) => ((becky = seen(c)), reply("Five interviews for $0."))],
    });
    sendMessage(team.id, "Chandler, ask Becky the cheapest test.");
    await idle();
    expect(said(team.id)).toEqual(["user: Chandler, ask Becky the cheapest test.", "Chandler: Becky, cheapest test?", "Becky: Five interviews for $0."]);
    expect(becky).toContain("[Chandler] Becky, cheapest test?");
    expect(becky).toContain("Chandler's message is the newest here.");
  });

  it("wakes only the teammates a member @mentions", async () => {
    const { team } = crew();
    const calls = scriptMembers(faux, { Ada: [reply("@Cy can you check?")], Cy: [reply("Checked.")] });
    sendMessage(team.id, "@Ada start");
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Ada: @Cy can you check?", "Cy: Checked."]);
    expect(calls.Bo).toBe(1); // not for Ada's @Cy message, only for Cy's plain answer
  });

  it(`stops members waking each other ${TEAM_TURNS_MAX} levels after the user's message`, async () => {
    const { team } = crew(["Ada", "Bo"]);
    const talk = (who: string) => Array.from({ length: 10 }, (_, i) => reply(`${who} ${i}.`));
    scriptMembers(faux, { Ada: talk("Ada"), Bo: talk("Bo") });
    sendMessage(team.id, "@Ada talk it over with Bo.");
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Ada: Ada 0.", "Bo: Bo 0.", "Ada: Ada 1.", "Bo: Bo 1."].slice(0, TEAM_TURNS_MAX));
    // The user's next message starts again from the top.
    sendMessage(team.id, "@Bo one more.");
    await idle();
    expect(said(team.id).filter((l) => l.startsWith("Bo:")).length).toBeGreaterThan(2);
  });

  it("wakes a member once for teammates writing at the same time", async () => {
    const { team } = crew();
    const g = gate();
    const calls = scriptMembers(faux, { Ada: [async () => (await g.wait, reply("Ada first."))], Bo: [async () => (await g.wait, reply("Bo first."))] });
    sendMessage(team.id, "Go.");
    await until(() => (listTeams().find((t) => t.id === team.id)?.replying.length ?? 0) === 3);
    g.open();
    await idle();
    // Cy: once for the user, then once more for both answers (not twice); Ada and Bo once each for the other's.
    expect(calls).toEqual({ Ada: 2, Bo: 2, Cy: 2 });
  });

  it("lets replies being written post when the user writes again, then wakes everyone for the new message", async () => {
    const { team } = crew(["Becky", "Chandler"]);
    const g = gate();
    let told = "";
    scriptMembers(faux, {
      Becky: [async () => (await g.wait, reply("Floor is $50,000.")), (c) => ((told = seen(c)), reply("Correction: $60,000."))],
      Chandler: [async () => (await g.wait, reply("Spend nothing over $50,000."))],
    });
    sendMessage(team.id, "Plan it.");
    await until(() => (listTeams().find((t) => t.id === team.id)?.replying.length ?? 0) === 2);
    sendMessage(team.id, "The floor is now $60,000.");
    g.open();
    await idle();
    const lines = said(team.id);
    expect(lines).toContain("Becky: Floor is $50,000.");
    expect(lines).toContain("Chandler: Spend nothing over $50,000.");
    expect(lines.at(-1)).toBe("Becky: Correction: $60,000.");
    expect(told).toContain("The floor is now $60,000.");
    expect(sprocketRuns.list(["cancelled"], team.id)).toEqual([]);
  });

  it("shows a question's options, waits, and gives a tapped option only to whoever asked", async () => {
    const { team, members } = crew();
    scriptMembers(faux, { Bo: [ask("Which mood?", ["Calm", "Bold"])] });
    sendMessage(team.id, "@Bo I need an icon idea. Ask me first.");
    await idle();
    const question = listMessages(team.id).at(-1)!;
    expect(question).toMatchObject({ author: "sprocket", sprocketId: members[1].id, text: "Which mood?", ask: { question: "Which mood?", options: ["Calm", "Bold"] } });
    expect(listTeams().find((t) => t.id === team.id)).toMatchObject({ running: false, replying: [], waiting: [] });

    // A question for the user wakes nobody, and others are told it waits.
    let told = "";
    scriptMembers(faux, { Cy: [(c) => ((told = seen(c)), reply("Cy here."))] });
    sendMessage(team.id, "@Cy meanwhile, any risks?");
    await idle();
    expect(told).toContain('Waiting for your user\'s answer: Bo asked "Which mood?"');
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBeUndefined();

    const calls = scriptMembers(faux, { Bo: [reply("Calm it is: a sprout.")] });
    sendMessage(team.id, "Calm");
    await idle();
    expect(said(team.id).at(-1)).toBe("Bo: Calm it is: a sprout.");
    expect(calls.Bo).toBe(1);
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBe("Calm");
  });

  it("gives a typed answer to every member, the asker included, and the question is answered", async () => {
    const { team } = crew();
    scriptMembers(faux, { Bo: [ask("What does the app do?", [])] });
    sendMessage(team.id, "@Bo icon idea?");
    await idle();
    scriptMembers(faux, { Bo: [reply("A sprout, then.")] });
    sendMessage(team.id, "It tracks habits");
    await idle();
    expect(said(team.id).at(-1)).toBe("Bo: A sprout, then.");
    expect(waitingAsks(team.id)).toEqual([]);
  });

  it("drops a member's own name from the front of its message", async () => {
    const { team } = crew();
    scriptMembers(faux, { Ada: [reply("[Ada] Sure.")], Bo: [reply("**Bo:** Yes.")] });
    sendMessage(team.id, "@Ada ready?");
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Ada: Sure.", "Bo: Yes."]);
  });

  it("shows a member the others' messages by name, who else is answering, and the team without a lead", async () => {
    const { team } = crew();
    const g = gate();
    let context: TranscriptContext | undefined;
    scriptMembers(faux, { Ada: [async () => (await g.wait, reply("Ada's first."))], Bo: [async (c) => (await g.wait, (context = c), reply("(quiet)"))] });
    sendMessage(team.id, "Start.");
    await until(() => (listTeams().find((t) => t.id === team.id)?.replying.length ?? 0) === 3);
    g.open();
    await idle();
    const text = seen(context!);
    expect(text).toContain('"Crew"');
    expect(text).not.toMatch(/\(lead\)|You lead|pass_turn|gave you the turn/);
    expect(text).toMatch(/Ada and Cy are reading it too/);
    expect(text).toContain("(quiet)");

    let later = "";
    scriptMembers(faux, { Bo: [(c) => ((later = seen(c)), reply("Bo here."))] });
    sendMessage(team.id, "@Bo again.");
    await idle();
    expect(later).toContain("[Ada] Ada's first.");
  });

  it("stops a team's turns when the chat is cleared", async () => {
    const { team } = crew();
    const g = gate();
    scriptMembers(faux, { Ada: [async () => (await g.wait, reply("Should not post."))] });
    sendMessage(team.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    clearChat(team.id);
    g.open();
    await idle();
    expect(said(team.id)).toEqual([]);
  });

  it("gives each member the tools of its direct chat, and ask_user, but no pass_turn", async () => {
    const { members, team } = crew(["Ada", "Bo"]);
    updateSettings(members[0].id, { projectId: projects.create("app", "/work/team-tools").id });
    const tools: Record<string, string> = {};
    const look = (name: string) => (c: TranscriptContext) => ((tools[name] = JSON.stringify(c.messages[0])), reply("(quiet)"));
    scriptMembers(faux, { Ada: [look("Ada")], Bo: [look("Bo")] });
    sendMessage(team.id, "Go.");
    await idle();
    expect(tools.Ada).toContain("project_board");
    expect(tools.Ada).toContain("project_chat");
    expect(tools.Ada).toContain("ask_user");
    expect(tools.Ada).not.toContain("pass_turn");
    expect(tools.Bo).not.toContain("project_board");
  });

  it("takes a deleted Sprocket out of its teams and keeps what it wrote", async () => {
    const { members, team } = crew();
    const [a, b, c] = members;
    scriptMembers(faux, { Ada: [reply("Ada was here.")] });
    sendMessage(team.id, "@Ada hi.");
    await idle();
    deleteSprocket(a.id);
    expect(listTeams().find((x) => x.id === team.id)?.members).toEqual([b.id, c.id]);
    expect(said(team.id)).toEqual(["user: @Ada hi.", "deleted: Ada was here."]);

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
