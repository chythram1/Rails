import { fauxAssistantMessage, fauxProvider, type ClassifierContext, type ClassifierResult, type Provider } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { receive } from "./bridge/index.ts";
import { panels, projects, settings, sprockets } from "./db.ts";
import { decisionLog, settled, setDecisionModel, startDecisions, toJudge } from "./decisions.ts";
import { models, modelSettings, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, listMessages, updateSettings } from "./sprockets.ts";
import { GRACE_MS, startWatches } from "./watches.ts";

const look = { character: "lune", color: "teal", accessory: "none" } as const;

// A chat model for the Coordinator, and a stand-in decision service that answers what each test says.
const faux = fauxProvider();
models.setProvider(faux.provider);
let answer: (context: ClassifierContext) => Partial<ClassifierResult> = () => ({});
const asked: ClassifierContext[] = [];
const judge: Provider = {
  ...faux.provider,
  id: "judge",
  name: "Judge",
  getModels: () => [],
  getAllModels: () => [{ type: "classifier", id: "judge-1", name: "Judge", api: "judge", provider: "judge", baseUrl: "", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000 }] as never,
  classify: async (_model, context) => {
    asked.push(context);
    return { api: "judge", provider: "judge", model: "judge-1.2", answers: {}, stopReason: "stop", timestamp: Date.now(), ...answer(context) };
  },
};
models.setProvider(judge);
startWatches();
startDecisions();

beforeEach(() => {
  settings.set("defaultModel", refOf(faux.getModel()));
  settings.set("decisionModel", null);
  asked.length = 0;
});

const asks = (p: number) => () => ({ answers: { asks_user: { type: "bool" as const, probability: p } } });

function project(coordinated = true) {
  const p = projects.create("app", `/work/dec-${Math.random()}`);
  if (coordinated) updateSettings(createSprocket({ name: "Lead", look }).id, { projectId: p.id, coordinator: true });
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
