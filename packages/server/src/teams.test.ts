// Team chats (ADR 0022, 0023): the user and two to four Sprockets. The user's message goes to those it @mentions,
// else (a tapped option) to whoever asked, else to whom the decision model picks, else to members whose questions
// wait for an answer, else the lead. A member gives a teammate the turn with pass_turn (back and forth too), at most
// TEAM_TURNS_MAX times in a row.
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type ClassifierContext, type ClassifierResult, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { TEAM_TURNS_MAX } from "@rails/shared";
import { projects, settings, sprockets } from "./db.ts";
import { createTeam, deleteTeam, listTeams, mentioned, updateTeam } from "./teams.ts";
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

  it("asks the decision model who a message without @ is for, and falls back to the lead", async () => {
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
    // Nobody's face shows while the model judges; then only Bo answers (Cy is below the bar).
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
    // With an @mention it isn't asked.
    let more = 0;
    judged = () => (more++, {});
    faux.setResponses([reply("Yes.")]);
    sendMessage(team.id, "@Cy ready?");
    await settled();
    expect(said(team.id).at(-1)).toBe("Cy: Yes.");
    expect(more).toBe(0);
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

  it("with the decision model, gives a typed message to whoever it's for while a question waits; a tap goes to the asker", async () => {
    const { team } = crew();
    settings.set("decisionModel", "judge/judge-1");
    let state: Record<string, unknown> = {};
    let calls = 0;
    let pick = 0;
    judged = (c) => {
      calls++;
      state = c.state as Record<string, unknown>;
      return { answers: Object.fromEntries([0, 1, 2].map((i) => [`member_${i}`, { type: "bool", probability: i === pick ? 0.9 : 0.1 }])) };
    };
    faux.setResponses([ask("Which mood?", ["Calm", "Bold"])]);
    sendMessage(team.id, "@Bo icon idea? Ask me first.");
    await settled();
    const question = listMessages(team.id).at(-1)!;

    // For Ada, says the model: Ada answers, and Bo's question still waits.
    faux.setResponses([reply("Cy writes the copy.")]);
    sendMessage(team.id, "Love it. Ada, who writes the copy?");
    await settled();
    expect(state.questions_waiting_for_the_users_answer).toEqual(["Bo: Which mood?"]);
    expect(said(team.id).at(-1)).toBe("Ada: Cy writes the copy.");
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBeUndefined();

    // A tapped option goes to Bo without asking the model.
    const before = calls;
    faux.setResponses([reply("Calm: a sprout.")]);
    sendMessage(team.id, "calm");
    await settled();
    expect(calls).toBe(before);
    expect(said(team.id).at(-1)).toBe("Bo: Calm: a sprout.");
    expect(listMessages(team.id).find((m) => m.id === question.id)?.ask?.answer).toBe("calm");

    // The model failing: a typed answer goes to whoever asked.
    faux.setResponses([ask("What does it do?", [])]);
    sendMessage(team.id, "@Cy ask me something");
    await settled();
    judged = () => ({ stopReason: "error", errorMessage: "down" });
    faux.setResponses([reply("Got it.")]);
    sendMessage(team.id, "It tracks habits");
    await settled();
    expect(said(team.id).at(-1)).toBe("Cy: Got it.");
  });

  it("won't pass the turn to a member whose turn already comes, and tells a member who answers after it", async () => {
    const { team } = crew();
    let result = "";
    let told = "";
    faux.setResponses([
      (c) => ((told = seen(c)), pass("Bo, yours?", "Bo")),
      (c) => {
        const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
        result = r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
        return reply("Mine: red.");
      },
      reply("Blue."),
      reply("Green."),
    ]);
    sendMessage(team.id, "@everyone a colour each.");
    await settled();
    expect(told).toContain("Bo and Cy have a turn after yours");
    expect(result).toMatch(/Bo already has a turn coming after yours/);
    expect(said(team.id).slice(1)).toEqual(["Ada: Bo, yours?", "Ada: Mine: red.", "Bo: Blue.", "Cy: Green."]);
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
    await settled();
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
    await settled();
    expect(reminded).toContain("You asked Bo something but didn't pass the turn");
    expect(said(team.id).slice(1)).toEqual(["Ada: Bo, which colour?", "pass: Ada → Bo", "Bo: Blue."]);

    // It leaves it: what it writes then isn't posted.
    faux.setResponses([reply("What do you think, Cy?"), reply("It was for the user, never mind.")]);
    sendMessage(team.id, "Another?");
    await settled();
    expect(said(team.id).at(-1)).toBe("Ada: What do you think, Cy?");

    // Only mentioned in passing: no reminder.
    faux.setResponses([reply("Thanks Bo!")]);
    sendMessage(team.id, "Done.");
    await settled();
    expect(faux.getPendingResponseCount()).toBe(0);
    expect(said(team.id).at(-1)).toBe("Ada: Thanks Bo!");
  });

  it("drops a member's own name from the front of its message", async () => {
    const { team } = crew();
    faux.setResponses([reply("[Ada] Sure."), reply("**Bo:** Yes.")]);
    sendMessage(team.id, "Ready?");
    await settled();
    sendMessage(team.id, "@Bo ready?");
    await settled();
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
