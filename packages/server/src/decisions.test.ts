import { fauxAssistantMessage, fauxProvider, type ClassifierContext, type ClassifierResult, type Provider } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { receive } from "./bridge/index.ts";
import { panels, projects, settings, sprockets } from "./db.ts";
import { ACT_ASKS, ACT_QUESTION, decisionLog, settled, setDecisionModel, setDecisionThreshold, startDecisions, toJudge, wakeFor } from "./decisions.ts";
import { models, modelSettings, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, listMessages, updateSettings } from "./sprockets.ts";
import { GRACE_MS, startWatches } from "./watches.ts";

const look = { character: "lune", color: "teal", accessory: "none" } as const;

// A chat model for the Coordinator, and a stand-in decision service that answers what each test says.
const faux = fauxProvider();
models.setProvider(faux.provider);
let answer: (context: ClassifierContext) => Partial<ClassifierResult> = () => ({});
/** Holds the model's answer back until a test lets it go (to let a session move on meanwhile). */
let gate: Promise<void> = Promise.resolve();
const asked: ClassifierContext[] = [];
const judge: Provider = {
  ...faux.provider,
  id: "judge",
  name: "Judge",
  getModels: () => [],
  getAllModels: () => [{ type: "classifier", id: "judge-1", name: "Judge", api: "judge", provider: "judge", baseUrl: "", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000 }] as never,
  classify: async (_model, context) => {
    asked.push(context);
    await gate;
    return { api: "judge", provider: "judge", model: "judge-1.2", answers: {}, stopReason: "stop", timestamp: Date.now(), ...answer(context) };
  },
};
models.setProvider(judge);
startWatches();
startDecisions();

beforeEach(() => {
  settings.set("defaultModel", refOf(faux.getModel()));
  settings.set("decisionModel", null);
  delete process.env.RAILS_DECISIONS;
  gate = Promise.resolve();
  asked.length = 0;
});

const asks = (p: number) => () => ({ answers: { asks_user: { type: "bool" as const, probability: p } } });

function project(coordinated = true) {
  const p = projects.create("app", `/work/dec-${Math.random()}`);
  if (coordinated) updateSettings(createSprocket({ name: "Lead", look }).id, { projectId: p.id });
  return { project: p, panel: panels.create({ projectId: p.id, kind: "claude", title: "Fix sidebar" }) };
}

describe("what the decision model judges", () => {
  it("judges turn ends and dialogs Rails doesn't know, nothing else", () => {
    expect(toJudge({ kind: "turn_end", text: "Done. Should I push?" })).toEqual({ question: "turn_end", text: "Done. Should I push?", rails: "asks" });
    expect(toJudge({ kind: "turn_end", text: "All tests pass." })?.rails).toBe("doesn't ask");
    expect(toJudge({ kind: "waiting", reason: "Pick a deploy target" })).toEqual({ question: "dialog", text: "Pick a deploy target", rails: "unknown" });
    for (const reason of ["permission for Bash", "approval", "question", "a form", "input"]) expect(toJudge({ kind: "waiting", reason })).toBeUndefined();
    expect(toJudge({ kind: "prompt", text: "go" })).toBeUndefined();
    expect(toJudge({ kind: "turn_end", text: "x".repeat(3000) })!.text.length).toBe(1501);
  });
});

describe("the shadow log", () => {
  it("doesn't credit a dialog's wake to a turn end", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { project: p, panel } = project();
    answer = asks(0.1);
    faux.setResponses([fauxAssistantMessage("It's asking which colour.")]);
    receive(panel.id, "claude", "Stop", { last_assistant_message: "All tests pass." });
    await settled();
    vi.useFakeTimers();
    receive(panel.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which colour?", options: [{ label: "Green" }] }] } });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(asked.length).toBe(1));
    const lead = sprockets.coordinatorOf(p.id)!;
    await vi.waitFor(() => expect(listMessages(lead.id).map((m) => m.event?.what)).toContain("question")); // it did wake
    await idle();
    expect(decisionLog().entries.find((e) => e.panelId === panel.id)!.outcome).toBeUndefined();
  });

  it("offers the classifiers of providers that are set up, and refuses others", async () => {
    expect((await modelSettings()).classifiers.map((c) => c.ref)).toContain("judge/judge-1");
    await expect(setDecisionModel("openai/gpt-6-luna")).rejects.toThrow("Unknown decision model");
    await setDecisionModel("judge/judge-1");
    expect((await modelSettings()).decisionModel).toBe("judge/judge-1");
  });

  it("judges nothing until a model is picked, or in a project without a Coordinator", async () => {
    const { panel } = project();
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Should I push?" });
    settings.set("decisionModel", "judge/judge-1");
    const other = project(false);
    receive(other.panel.id, "claude", "Stop", { last_assistant_message: "Should I push?" });
    await settled();
    expect(asked).toEqual([]);
  });

  it("logs the model's answer next to Rails' own, with the model's version, latency and cost", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { panel } = project();
    const usage = { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 50, cost: { input: 0.00001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00001 } };
    answer = (context) => (String(context.state.message_end).includes("docs") ? { ...asks(0.9)(), usage } : asks(0.8)());
    receive(panel.id, "claude", "Stop", { last_assistant_message: "I'm done. Want me to also update the docs" }); // no "?": Rails' code still hears it
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Fixed it. Curious what you make of the approach." }); // Rails misses this one
    await settled();
    expect(asked.map((c) => c.state)).toContainEqual({ agent: "Claude Code", message_end: "I'm done. Want me to also update the docs" });
    expect(Object.keys(asked[0].questions)).toEqual(["asks_user"]);
    const entries = decisionLog().entries;
    const agreed = entries.find((e) => e.text.includes("docs"))!;
    const missed = entries.find((e) => e.text.includes("approach"))!;
    expect(agreed).toMatchObject({ question: "turn_end", rails: "asks", answer: { label: "asks", probability: 0.9 }, model: "judge-1.2", cost: 0.00001, title: "Fix sidebar" });
    expect(agreed.latencyMs).toBeGreaterThanOrEqual(0);
    expect(missed).toMatchObject({ rails: "doesn't ask", answer: { label: "asks" } });
  });

  it("asks what a dialog Rails doesn't know is", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { panel } = project();
    answer = () => ({ answers: { dialog_kind: { type: "choice", choice: "approval", probabilities: { question: 0.1, approval: 0.85, other: 0.05 }, confidence: 0.8 } } });
    receive(panel.id, "pi", "ui_prompt_start", { title: "Approve write to notes.txt?", kind: "confirm" });
    await settled();
    expect(asked[0].state).toEqual({ agent: "Claude Code", dialog_title: "Approve write to notes.txt?" });
    expect(decisionLog().entries[0]).toMatchObject({ question: "dialog", rails: "unknown", answer: { label: "approval", probability: 0.85 } });
  });

  it("logs failures instead of answers", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { panel } = project();
    answer = () => ({ stopReason: "error", errorMessage: "401 invalid API key" });
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Should I push?" });
    await settled();
    expect(decisionLog().entries[0]).toMatchObject({ error: "401 invalid API key" });
    expect(decisionLog().entries[0].answer).toBeUndefined();
  });

  it("follows a wake to the Coordinator's verdict, and counts where the model and Rails differ", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { project: p, panel } = project();
    answer = asks(0.2); // the model thinks it doesn't ask; Rails' code wakes the Coordinator anyway
    faux.setResponses([fauxAssistantMessage("(quiet)")]);
    vi.useFakeTimers();
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Why did it fail? The cache was stale. Should I explain more?" });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await settled();
    const lead = sprockets.coordinatorOf(p.id)!;
    await vi.waitFor(() => expect(listMessages(lead.id).length).toBeGreaterThan(0));
    await idle();
    const entry = decisionLog().entries.find((e) => e.panelId === panel.id)!;
    expect(entry).toMatchObject({ rails: "asks", answer: { label: "doesn't ask" }, outcome: "nothing needed" });
    const { summary } = decisionLog();
    expect(summary.extra).toBeGreaterThanOrEqual(1);
    expect(summary.quiet).toBeGreaterThanOrEqual(1);
    expect(summary.missed).toBeGreaterThanOrEqual(0);
  });
});

describe("the decision model waking the Coordinator (ADR 0013)", () => {
  // A picked decision model may act; only RAILS_DECISIONS=shadow keeps it to judging.
  const turnEnd = (text: string) => toJudge({ kind: "turn_end", text })!;
  const dialog = (title: string) => toJudge({ kind: "waiting", reason: title })!;

  it("acts only where the rules didn't wake, and only when it's sure", () => {
    const missed = turnEnd("Curious what you make of the new name.");
    expect(wakeFor(missed, { label: "asks", probability: ACT_ASKS }, "d1")).toEqual({ what: "turn_end", text: "Curious what you make of the new name.", decisionId: "d1" });
    expect(wakeFor(missed, { label: "asks", probability: ACT_ASKS - 0.01 }, "d1")).toBeUndefined();
    expect(wakeFor(turnEnd("Should I push?"), { label: "asks", probability: 0.99 }, "d1")).toBeUndefined(); // the rules wake for it already
    expect(wakeFor(turnEnd("All done."), { label: "doesn't ask", probability: 0.99 }, "d1")).toBeUndefined(); // it never cancels or adds a "no"
    expect(wakeFor(dialog("Pick a deploy target"), { label: "question", probability: ACT_QUESTION }, "d2")).toEqual({ what: "question", text: "Pick a deploy target", decisionId: "d2" });
    expect(wakeFor(dialog("Approve write to a.txt?"), { label: "approval", probability: 1 }, "d2")).toBeUndefined();
    expect(wakeFor(dialog("Pick a deploy target"), { label: "question", probability: 0.9 }, "d2")).toBeUndefined();
  });

  it("acts at the threshold the user set, a dialog 5 points higher", async () => {
    const missed = turnEnd("Curious what you make of the new name.");
    try {
      setDecisionThreshold(0.8);
      expect(wakeFor(missed, { label: "asks", probability: 0.8 }, "d1")).toBeDefined();
      expect(wakeFor(missed, { label: "asks", probability: 0.79 }, "d1")).toBeUndefined();
      expect(wakeFor(dialog("Pick a deploy target"), { label: "question", probability: 0.85 }, "d2")).toBeDefined();
      expect(wakeFor(dialog("Pick a deploy target"), { label: "question", probability: 0.84 }, "d2")).toBeUndefined();
      setDecisionThreshold(0.97); // a dialog's bar stops at 0.99
      expect(wakeFor(dialog("Pick a deploy target"), { label: "question", probability: 0.99 }, "d2")).toBeDefined();
      expect((await modelSettings()).decisionThreshold).toBe(0.97);
      for (const bad of [0.4, 1, "0.9", NaN, null]) expect(() => setDecisionThreshold(bad)).toThrow(/from 0\.5 to 0\.99/);
    } finally {
      settings.set("decisionThreshold", null);
    }
    expect((await modelSettings()).decisionThreshold).toBe(ACT_ASKS); // the default
  });

  it("wakes the Coordinator for a question the rules missed, when it's allowed to", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { project: p, panel } = project();
    const lead = sprockets.coordinatorOf(p.id)!;
    answer = asks(0.95);
    faux.setResponses([fauxAssistantMessage("It wants your take on the new name.")]);
    vi.useFakeTimers();
    receive(panel.id, "claude", "Stop", { last_assistant_message: "I renamed the helper. Curious what you make of the new name." });
    await vi.waitFor(() => expect(decisionLog().entries.find((e) => e.panelId === panel.id)?.answer).toBeDefined());
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(lead.id).length).toBeGreaterThan(0));
    await idle();
    const [event, reply] = listMessages(lead.id);
    expect(event.event).toMatchObject({ what: "turn_end", byModel: true });
    expect(reply.text).toBe("It wants your take on the new name.");
    const entry = decisionLog().entries.find((e) => e.panelId === panel.id)!;
    expect(entry).toMatchObject({ rails: "doesn't ask", acted: true, outcome: "told you" });
    expect(decisionLog().summary.acted).toBeGreaterThanOrEqual(1);
  });

  it("only judges in shadow (RAILS_DECISIONS=shadow, a developer setting)", async () => {
    settings.set("decisionModel", "judge/judge-1");
    process.env.RAILS_DECISIONS = "shadow";
    expect((await modelSettings()).decisionsInShadow).toBe(true);
    const { project: p, panel } = project();
    answer = asks(0.99);
    vi.useFakeTimers();
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Curious what you make of the new name." });
    await vi.waitFor(() => expect(decisionLog().entries.find((e) => e.panelId === panel.id)?.answer).toBeDefined());
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    expect(listMessages(sprockets.coordinatorOf(p.id)!.id)).toEqual([]);
  });

  it("doesn't act on a judgment the session has moved on from", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { project: p, panel } = project();
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    answer = asks(0.99);
    vi.useFakeTimers();
    receive(panel.id, "claude", "Stop", { last_assistant_message: "Curious what you make of the new name." });
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "I like it, carry on" }); // the user answered while the model thought
    release();
    await vi.waitFor(() => expect(decisionLog().entries.find((e) => e.panelId === panel.id)?.answer).toBeDefined());
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    expect(listMessages(sprockets.coordinatorOf(p.id)!.id)).toEqual([]);
    expect(decisionLog().entries.find((e) => e.panelId === panel.id)!.acted).toBeUndefined();
  });

  it("wakes it for a dialog it's sure is a question, and tells the Coordinator it can't answer that one", async () => {
    settings.set("decisionModel", "judge/judge-1");
    const { project: p, panel } = project();
    const lead = sprockets.coordinatorOf(p.id)!;
    answer = () => ({ answers: { dialog_kind: { type: "choice", choice: "question", probabilities: { question: 0.97, approval: 0.02, other: 0.01 }, confidence: 0.95 } } });
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage("It asks which environment to deploy to.");
      },
    ]);
    vi.useFakeTimers();
    receive(panel.id, "pi", "ui_prompt_start", { title: "Which environment should I deploy to?", kind: "select" });
    await vi.waitFor(() => expect(decisionLog().entries.find((e) => e.panelId === panel.id)?.answer).toBeDefined());
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(lead.id).length).toBeGreaterThan(0));
    await idle();
    expect(listMessages(lead.id)[0].event).toMatchObject({ what: "question", byModel: true });
    expect(prompt).toContain("You can't suggest answers to dialogs Rails doesn't know");
  });
});
