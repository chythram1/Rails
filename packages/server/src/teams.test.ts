// Team chats (ADR 0022, 0023): the user and two to four Sprockets. The user's message goes to those it @mentions,
// else (a tapped option) to whoever asked, else to members whose questions wait for an answer, else the lead (never
// a model's guess). A member gives a teammate the turn with pass_turn (back and forth too), at most
// TEAM_TURNS_MAX times in a row.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { TEAM_TURNS_MAX } from "@rails/shared";
import { passTurnCapability } from "./harness/turns.ts";
import { projects, settings, sprockets } from "./db.ts";
import { createTeam, deleteTeam, listTeams, mentioned, updateTeam } from "./teams.ts";
import { models, refOf } from "./models.ts";
import { idle, waitingAsks } from "./runs.ts";
import { clearChat, createSprocket, deleteSprocket, listMessages, sendMessage, updateSettings } from "./sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
/** A decision model that counts its calls: team chats never ask it who answers. */
let judgeCalls = 0;
const judge: Provider = {
  ...faux.provider,
  id: "judge",
  name: "Judge",
  getModels: () => [],
  getAllModels: () => [{ type: "classifier", id: "judge-1", name: "Judge", api: "judge", provider: "judge", baseUrl: "", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000 }] as never,
  classify: async () => {
    judgeCalls++;
    return { api: "judge", provider: "judge", model: "judge-1", answers: {}, stopReason: "stop", timestamp: Date.now() };
  },
};
models.setProvider(judge);
const look = { character: "cog", color: "green", accessory: "none" } as const;
beforeEach(() => {
  settings.set("defaultModel", ref);
  settings.set("decisionModel", null);
});

const sprocket = (name: string) => createSprocket({ name, look });
/** Ada, Bo and Cy in a team called Crew, Ada leading. */
function crew(names = ["Ada", "Bo", "Cy"]) {
  const members = names.map(sprocket);
  return { members, team: createTeam({ name: "Crew", members: members.map((m) => m.id) }) };
}
/** The chat as the user reads it: who wrote each message. */
const nameOf = (id: string | undefined) => (id && sprockets.get(id)?.name) || "deleted";
const said = (chatId: string) =>
  listMessages(chatId).map((m) =>
    m.author === "pass" ? `pass: ${nameOf(m.sprocketId)} → ${nameOf(m.passTo)}` : `${m.author === "sprocket" ? nameOf(m.sprocketId) : m.author}: ${m.text}`,
  );
/** Everything a scripted model call was given, the system prompt first. */
const seen = (c: TranscriptContext) => c.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""))).join("\n");
const reply = (text: string) => fauxAssistantMessage(text);
/** A member's message, then pass_turn to `to` (its run ends there). */
const pass = (text: string, to: string, note = "go on") =>
  fauxAssistantMessage([fauxText(text), fauxToolCall("codemode", { code: `await tools.pass_turn(${JSON.stringify({ to, note })})` })], { stopReason: "toolUse" });
/** A question with options (ask_user; its run waits). */
const ask = (question: string, options: string[]) =>
  fauxAssistantMessage([fauxToolCall("codemode", { code: `await tools.ask_user(${JSON.stringify({ question, options })})` })], { stopReason: "toolUse" });
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

  it("sends the user's message to the lead, and a member gives a teammate the turn with pass_turn, ending its run", async () => {
    const { team } = crew();
    faux.setResponses([pass("The engine's done. Bo, are the docs behind?", "Bo"), reply("Two pages are."), reply("Not reached.")]);
    sendMessage(team.id, "What should we do next?");
    await idle();
    expect(said(team.id)).toEqual(["user: What should we do next?", "Ada: The engine's done. Bo, are the docs behind?", "pass: Ada → Bo", "Bo: Two pages are."]);
    expect(faux.getPendingResponseCount()).toBe(1); // no model call after the pass
    expect(listMessages(team.id).find((m) => m.author === "pass")?.text).toBe("go on"); // its note, on the line
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

  it("lets only @mentions pick members: a plain name or 'everyone' goes to the lead, @everyone to all", async () => {
    const { team } = crew();
    faux.setResponses([reply("Lead here."), reply("Lead again.")]);
    sendMessage(team.id, "Bo, what do you think?");
    await idle();
    sendMessage(team.id, "One idea from everyone, and reference cy");
    await idle();
    faux.setResponses([reply("A."), reply("B."), reply("C.")]);
    sendMessage(team.id, "@everyone one idea each");
    await idle();
    faux.setResponses([reply("Cy here."), reply("Doc here.")]);
    sendMessage(team.id, "@Cy then @bo?");
    await idle();
    expect(said(team.id).filter((l) => !l.startsWith("user"))).toEqual(["Ada: Lead here.", "Ada: Lead again.", "Ada: A.", "Bo: B.", "Cy: C.", "Cy: Cy here.", "Bo: Doc here."]);
  });

  it("never asks the decision model who answers: without an @, the asker of a waiting question, else the lead", async () => {
    const { team } = crew();
    settings.set("decisionModel", "judge/judge-1");
    faux.setResponses([pass("Bo, check the docs?", "Bo"), reply("Two pages are behind.")]);
    sendMessage(team.id, "Can someone check the docs?");
    await idle();
    faux.setResponses([reply("Noted.")]);
    sendMessage(team.id, "Good point, fix that");
    await idle();
    expect(said(team.id).slice(-2)).toEqual(["user: Good point, fix that", "Ada: Noted."]); // the lead, not Bo who spoke last
    faux.setResponses([ask("Which mood?", ["Calm", "Bold"]), ask("What does it do?", [])]);
    sendMessage(team.id, "@Bo @Cy ask me something");
    await idle();
    faux.setResponses([reply("A calm sprout."), reply("Got it.")]);
    sendMessage(team.id, "Calm, and it tracks habits");
    await idle();
    expect(said(team.id).slice(-2)).toEqual(["Bo: A calm sprout.", "Cy: Got it."]); // both askers
    expect(judgeCalls).toBe(0);
  });

  it("shows a question's options, waits, and gives the answer to whoever asked, even without an @", async () => {
    const { team, members } = crew();
    faux.setResponses([ask("Which mood?", ["Calm", "Bold"])]);
    sendMessage(team.id, "@Bo I need an icon idea. Ask me first.");
    await idle();
    const question = listMessages(team.id).at(-1)!;
    expect(question).toMatchObject({ author: "sprocket", sprocketId: members[1].id, text: "Which mood?", ask: { question: "Which mood?", options: ["Calm", "Bold"] } });
    expect(listTeams().find((t) => t.id === team.id)).toMatchObject({ running: false, waiting: [] });

    // An @mention of someone else goes to them; the question still waits.
    faux.setResponses([reply("Cy here.")]);
    sendMessage(team.id, "@Cy meanwhile, any risks?");
    await idle();
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBeUndefined();

    faux.setResponses([reply("Calm it is: a sprout.")]);
    sendMessage(team.id, "Calm");
    await idle();
    expect(said(team.id).at(-1)).toBe("Bo: Calm it is: a sprout.");
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBe("Calm");

    // Answered: the next message without @ goes to the lead again.
    faux.setResponses([reply("Lead.")]);
    sendMessage(team.id, "Thanks");
    await idle();
    expect(said(team.id).at(-1)).toBe("Ada: Lead.");
  });

  it("passes the turn back and forth, but not to someone outside the team", async () => {
    const { team } = crew(["Ada", "Bo"]);
    let results: string[] = [];
    const resultOf = (c: TranscriptContext) => {
      const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
      return r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
    };
    faux.setResponses([
      pass("Bo, which colour?", "Bo"),
      pass("Blue. Ada, agreed?", "Ada"),
      pass("Agreed. Zed, thoughts?", "Zed"),
      (c) => (results.push(resultOf(c)), reply("Then blue it is.")),
    ]);
    sendMessage(team.id, "Pick a colour.");
    await idle();
    expect(said(team.id).slice(1)).toEqual([
      "Ada: Bo, which colour?",
      "pass: Ada → Bo",
      "Bo: Blue. Ada, agreed?",
      "pass: Bo → Ada",
      "Ada: Agreed. Zed, thoughts?",
      "Ada: Then blue it is.",
    ]);
    expect(results[0]).toMatch(/no teammate called "Zed"/);
  });

  it("won't pass the turn to a member whose turn already comes, and tells a member who answers after it", async () => {
    const { team } = crew();
    let result = "";
    let told = "";
    faux.setResponses([
      (c) => ((told = seen(c)), pass("", "Bo")),
      (c) => {
        const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
        result = r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
        return reply("Mine: red.");
      },
      reply("Blue."),
      reply("Green."),
    ]);
    sendMessage(team.id, "@everyone a colour each.");
    await idle();
    expect(told).toContain("Bo and Cy have a turn after yours");
    expect(result).toMatch(/Bo already has a turn coming after yours: they'll answer it themselves/);
    expect(said(team.id).slice(1)).toEqual(["Ada: Mine: red.", "Bo: Blue.", "Cy: Green."]);
  });

  it("ends the turn, without a pass, when a member who has posted passes to one whose turn already comes", async () => {
    const { team } = crew();
    // Told to answer themselves after already answering, models wrote it again; now the run just ends.
    faux.setResponses([pass("Red. Bo, yours?", "Bo"), reply("Blue."), reply("Green.")]);
    sendMessage(team.id, "@everyone a colour each.");
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Ada: Red. Bo, yours?", "Bo: Blue.", "Cy: Green."]);
  });

  it("won't pass the turn before the member has written anything, and doesn't post a message twice", async () => {
    const { team } = crew();
    let result = "";
    const lastResult = (c: TranscriptContext) => {
      const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
      return r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
    };
    const silentPass = fauxAssistantMessage([fauxToolCall("codemode", { code: `await tools.pass_turn({ to: "Bo", note: "draft it" })` })], { stopReason: "toolUse" });
    const draft = "Here is my draft of the launch post for this week, with the main points first.";
    faux.setResponses([
      silentPass,
      (c) => ((result = lastResult(c)), pass(draft, "Ada")), // to Ada herself: refused
      fauxAssistantMessage(draft.replace("my draft", "the draft")), // said again, reworded a little
    ]);
    sendMessage(team.id, "Draft the launch post.");
    await idle();
    expect(result).toMatch(/You haven't written anything in the chat this turn/);
    expect(said(team.id).slice(1)).toEqual([`Ada: ${draft}`]);
  });

  it("asks an open question without options, and the answer comes back", async () => {
    const { team, members } = crew();
    faux.setResponses([ask("What does the app do?", [])]);
    sendMessage(team.id, "@Bo icon idea?");
    await idle();
    expect(listMessages(team.id).at(-1)).toMatchObject({ sprocketId: members[1].id, ask: { question: "What does the app do?", options: [] } });
    faux.setResponses([reply("A sprout, then.")]);
    sendMessage(team.id, "It tracks habits");
    await idle();
    expect(said(team.id).at(-1)).toBe("Bo: A sprout, then.");
  });

  it("reminds a member that asked a teammate something without passing the turn, once, and posts nothing more", async () => {
    const { team } = crew();
    const passOnly = (to: string) =>
      fauxAssistantMessage([fauxToolCall("codemode", { code: `await tools.pass_turn({ to: ${JSON.stringify(to)}, note: "pick one" })` })], { stopReason: "toolUse" });
    let reminded = "";
    faux.setResponses([reply("Bo, which colour?"), (c) => ((reminded = seen(c)), passOnly("Bo")), reply("Blue.")]);
    sendMessage(team.id, "Pick a colour.");
    await idle();
    expect(reminded).toContain("You asked Bo something but didn't pass the turn");
    expect(said(team.id).slice(1)).toEqual(["Ada: Bo, which colour?", "pass: Ada → Bo", "Bo: Blue."]);

    // It leaves it: what it writes then isn't posted.
    faux.setResponses([reply("What do you think, Cy?"), reply("It was for the user, never mind.")]);
    sendMessage(team.id, "Another?");
    await idle();
    expect(said(team.id).at(-1)).toBe("Ada: What do you think, Cy?");

    // Only mentioned in passing: no reminder.
    faux.setResponses([reply("Thanks Bo!")]);
    sendMessage(team.id, "Done.");
    await idle();
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(said(team.id).at(-1)).toBe("Ada: Thanks Bo!");
  });

  it("drops a member's own name from the front of its message", async () => {
    const { team } = crew();
    faux.setResponses([reply("[Ada] Sure."), reply("**Bo:** Yes.")]);
    sendMessage(team.id, "Ready?");
    await idle();
    sendMessage(team.id, "@Bo ready?");
    await idle();
    expect(said(team.id)).toEqual(["user: Ready?", "Ada: Sure.", "user: @Bo ready?", "Bo: Yes."]);
  });

  it("shows whose turns are queued", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, reply("Bo.")), reply("Cy.")]);
    sendMessage(team.id, "@Bo @Cy go.");
    await new Promise((r) => setTimeout(r, 20));
    expect(listTeams().find((x) => x.id === team.id)).toMatchObject({ replying: crewIds(team)[1], waiting: [crewIds(team)[2]] });
    release();
    await idle();
    expect(said(team.id).slice(1)).toEqual(["Bo: Bo.", "Cy: Cy."]);
    expect(listTeams().find((x) => x.id === team.id)?.waiting).toEqual([]);
  });

  it(`stops passing the turn after ${TEAM_TURNS_MAX} passes in a row; the member posts its result instead`, async () => {
    const { team } = crew();
    const names = ["Ada", "Bo", "Cy"];
    let refused = "";
    faux.setResponses([
      ...Array.from({ length: TEAM_TURNS_MAX + 1 }, (_, i) => pass(`Step ${i}.`, names[(i + 1) % 3])),
      (c) => {
        const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
        refused = r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
        return reply("Here's where we are.");
      },
    ]);
    sendMessage(team.id, "Go round.");
    await idle();
    const lines = said(team.id);
    expect(lines.filter((l) => l.startsWith("pass:"))).toHaveLength(TEAM_TURNS_MAX);
    expect(refused).toMatch(new RegExp(`passed ${TEAM_TURNS_MAX} times`));
    expect(lines.at(-1)).toMatch(/: Here's where we are\.$/);
  });

  it("shows a member the others' messages by name, passes as Rails' notes, and the team in its instructions", async () => {
    const { team } = crew();
    let context: TranscriptContext | undefined;
    faux.setResponses([pass("Bo, your turn.", "Bo"), (c) => ((context = c), reply("Bo's first."))]);
    sendMessage(team.id, "Start.");
    await idle();
    const text = seen(context!);
    expect(text).toContain('"Crew"');
    expect(text).toMatch(/Ada \(lead\)/);
    expect(text).toContain("[Ada] Bo, your turn.");
    expect(text).toContain('[Rails] Ada gave you the turn: "go on".');
    expect(text).toMatch(/Ada gave you the turn \("go on"\), pass 1 of \d+/);
    expect(text).toContain("pass_turn");

    faux.setResponses([(c) => ((context = c), reply("Bo's second."))]);
    sendMessage(team.id, "@Bo again.");
    await idle();
    const own = context!.messages.find((m) => m.role === "assistant");
    expect(JSON.stringify(own)).toContain("Bo's first.");
  });

  it("drops the turns still queued, and a pass from a turn going on, when the user writes", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, pass("Bo, over to you.", "Bo")), reply("Cy only.")]);
    sendMessage(team.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    sendMessage(team.id, "@Cy just you, please.");
    release();
    await idle();
    expect(said(team.id)).toEqual(["user: Go.", "user: @Cy just you, please.", "Ada: Bo, over to you.", "Cy: Cy only."]);
  });

  it("stops a team's turns when the chat is cleared", async () => {
    const { team } = crew();
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    faux.setResponses([async () => (await gate, pass("Bo, yours.", "Bo")), reply("Bo should not answer.")]);
    sendMessage(team.id, "Go.");
    await new Promise((r) => setTimeout(r, 20));
    clearChat(team.id);
    release();
    await idle();
    expect(said(team.id)).toEqual([]);
  });

  it("doesn't pass the turn to a member whose question waits for the user (it asked again, seen live)", async () => {
    const { team } = crew(["Pam", "Fred"]);
    faux.setResponses([ask("Dark or light?", ["Dark", "Light"]), ask("What should the game be called?", [])]);
    sendMessage(team.id, "@everyone Ask me one question each.");
    await idle();
    expect(waitingAsks(team.id).map((a) => nameOf(a.sprocketId))).toEqual(["Pam", "Fred"]);
    // Pam's option is tapped: she's told Fred's question waits, and passing to him for it just ends her turn.
    let told = "";
    faux.setResponses([(c) => ((told = seen(c)), pass("Got it: dark. Fred, ask what the game should be called.", "Fred")), reply("Not reached.")]);
    sendMessage(team.id, "Dark");
    await idle();
    expect(told).toContain('Waiting for your user\'s answer: Fred asked "What should the game be called?"');
    expect(said(team.id).slice(-2)).toEqual(["user: Dark", "Pam: Got it: dark. Fred, ask what the game should be called."]);
    expect(waitingAsks(team.id).map((a) => nameOf(a.sprocketId))).toEqual(["Fred"]); // still once
    // Your answer to Fred then reaches him, and nothing waits any more.
    faux.setResponses([reply("Brassworks it is."), reply("Not reached.")]);
    sendMessage(team.id, "Brassworks Defense");
    await idle();
    expect(said(team.id).at(-1)).toBe("Fred: Brassworks it is.");
    expect(waitingAsks(team.id)).toEqual([]);
  });

  it("refuses a pass to a member whose question waits before the passer has said anything", async () => {
    const ends: unknown[] = [];
    const cap = (said: boolean) =>
      passTurnCapability([{ id: "f", name: "Fred" }], { hop: 0, queued: () => [], asking: () => ["f"], said: () => said }, (e) => ends.push(e), () => false);
    await expect(cap(false).run({ to: "Fred", note: "ask it" }, {} as never)).rejects.toThrow(/Fred's question is waiting for your user's answer/);
    expect(ends).toEqual([]);
    expect(await cap(true).run({ to: "Fred", note: "ask it" }, {} as never)).toMatch(/Your turn ends here/);
    expect(ends).toEqual([{ done: true }]);
  });

  it("gives each member the tools of its direct chat, and pass_turn and ask_user", async () => {
    const { members, team } = crew(["Ada", "Bo"]);
    updateSettings(members[0].id, { projectId: projects.create("app", "/work/team-tools").id });
    const tools: string[] = [];
    faux.setResponses([(c) => (tools.push(JSON.stringify(c.messages[0])), pass("Bo, yours.", "Bo")), (c) => (tools.push(JSON.stringify(c.messages[0])), reply("Ok."))]);
    sendMessage(team.id, "Go.");
    await idle();
    expect(tools[0]).toContain("project_board");
    expect(tools[0]).toContain("project_chat");
    expect(tools[0]).toContain("pass_turn");
    expect(tools[0]).toContain("ask_user");
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
