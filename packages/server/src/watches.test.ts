import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromClaude, fromPi, type SessionEvent } from "./bridge/events.ts";
import { receive } from "./bridge/index.ts";
import { panels, projects, settings } from "./db.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, directChat, listMessages, projectChat, listSprockets, updateSettings } from "./sprockets.ts";
import { admit, COOLDOWN_MS, GRACE_MS, looksLikeQuestion, startWatches, Watches, type Wake } from "./watches.ts";

const look = { character: "cog", color: "green", accessory: "none" } as const;

describe("looksLikeQuestion", () => {
  it("hears questions at the end of a reply", () => {
    for (const text of [
      "I fixed the login bug. Should I also update the tests?",
      "Done with step 1.\n\nShall I continue with step 2",
      "Two ways to do this: A or B. Which one do you prefer?",
      "The migration is ready. Want me to run it against staging",
      "I can either inline it or extract a helper. Let me know which you'd like.",
      "Before I proceed with deleting the old tables, I need your go-ahead.",
      "Here's the plan:\n1. Rename\n2. Move\n\n**Does this look right?**",
      "Which approach do you prefer?\n1. Inline it\n2. Extract a helper",
    ])
      expect(looksLikeQuestion(text), text).toBe(true);
  });

  it("ignores finished work, pleasantries, code and URLs", () => {
    for (const text of [
      "Fixed: the token expired early. All 42 tests pass.",
      "Done. Let me know if you have any other questions!",
      "Changed it to `const x = ok ? a : b;` and the build passes.",
      "```ts\nconst y = a ? b : c;\n```\nThat's the fix.",
      "Opened https://example.com/search?q=rails and copied the snippet.",
      "I confirmed the tests pass.",
      "Should I do that? Never mind, I did it.",
      "Why did it fail? The cache was stale, so I cleared it and reran the build.",
      "Done! Anything else?",
      "Summary:\n- fixed the login bug\n- updated 3 tests",
    ])
      expect(looksLikeQuestion(text), text).toBe(false);
  });

  it("only looks at the end of a long reply", () => {
    expect(looksLikeQuestion("Should I? " + "Then I did a lot of work. ".repeat(40))).toBe(false);
  });
});

describe("admit", () => {
  it("wakes for questions and forms, never for permissions or other extension dialogs", () => {
    const questions = [{ question: "Which colour?", options: ["Blue", "Green"] }];
    expect(admit({ kind: "waiting", reason: "question", questions })).toEqual({ what: "question", text: "Which colour?", questions });
    expect(admit({ kind: "waiting", reason: "a form" })).toEqual({ what: "question", text: "It's waiting for a form." });
    expect(admit({ kind: "waiting", reason: "input" })).toEqual({ what: "question", text: "It's waiting for input." });
    expect(admit({ kind: "waiting", reason: "permission for Bash" })).toBeNull();
    expect(admit({ kind: "waiting", reason: "approval" })).toBeNull();
    // A pi extension's own dialog (here an approval extension's): it may well be a permission.
    expect(admit(fromPi("ui_prompt_start", { title: "Approve write to /work/app/notes.txt?" })[0])).toBeNull();
  });

  it("wakes for a turn that ends with a question, keeping the end of it", () => {
    const long = "x".repeat(2000) + "\nShould I deploy it?";
    const wake = admit({ kind: "turn_end", text: long }) as Wake;
    expect(wake.what).toBe("turn_end");
    expect(wake.text.endsWith("Should I deploy it?")).toBe(true);
    expect(wake.text.length).toBeLessThanOrEqual(601);
    expect(admit({ kind: "turn_end", text: "All done." })).toBe("over");
  });

  it("ends a wait when the session moves on", () => {
    for (const e of [{ kind: "prompt", text: "yes" }, { kind: "resumed" }, { kind: "tool", tool: "Edit", files: [], edit: true }, { kind: "ended" }] as SessionEvent[])
      expect(admit(e)).toBe("over");
    expect(admit({ kind: "start" })).toBeNull();
  });
});

describe("Watches", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const question: SessionEvent = { kind: "turn_end", text: "Should I continue?" };

  it("wakes after the grace period if nobody answered", () => {
    const fire = vi.fn(() => true);
    new Watches(fire).handle("p1", [question]);
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledWith("p1", { what: "turn_end", text: "Should I continue?" });
  });

  it("doesn't wake when the user answers in time", () => {
    const fire = vi.fn(() => true);
    const w = new Watches(fire);
    w.handle("p1", [question]);
    vi.advanceTimersByTime(5_000);
    w.handle("p1", [{ kind: "prompt", text: "yes, go on" }]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(fire).not.toHaveBeenCalled();
  });

  it("wakes once per wait, keeping the first report (pi reports the question, then its dialog)", () => {
    const fire = vi.fn(() => true);
    const w = new Watches(fire);
    const questions = [{ question: "Which colour?", options: ["Blue", "Green"] }];
    w.handle("p1", [{ kind: "waiting", reason: "question", questions }]);
    w.handle("p1", [{ kind: "waiting", reason: "a prompt" }]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0]).toEqual(["p1", { what: "question", text: "Which colour?", questions }]);
  });

  it("paces wakes per session with a cooldown, which starts only when someone was woken", () => {
    let coordinator = false;
    const fire = vi.fn(() => coordinator);
    const w = new Watches(fire);
    w.handle("p1", [question]);
    vi.advanceTimersByTime(GRACE_MS); // no Coordinator yet: no cooldown either
    coordinator = true;
    w.handle("p1", [{ kind: "prompt", text: "go" }, question]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(fire).toHaveBeenCalledTimes(2);
    // Asked again right away: it wakes when the cooldown is over, not after the grace period.
    w.handle("p1", [{ kind: "prompt", text: "go" }, question]);
    vi.advanceTimersByTime(GRACE_MS);
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(COOLDOWN_MS - GRACE_MS);
    expect(fire).toHaveBeenCalledTimes(3);
    // ...and not at all if the user answered meanwhile.
    w.handle("p1", [{ kind: "prompt", text: "go" }, question, { kind: "prompt", text: "answered" }]);
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it("wakes once for a wait the agent reports again, and again for the next wait", () => {
    const fire = vi.fn(() => true);
    const w = new Watches(fire);
    const input: SessionEvent = { kind: "waiting", reason: "input" }; // Codex repeats its status
    w.handle("p1", [input]);
    vi.advanceTimersByTime(GRACE_MS);
    w.handle("p1", [input]);
    vi.advanceTimersByTime(COOLDOWN_MS + GRACE_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    w.handle("p1", [{ kind: "resumed" }, question]);
    vi.advanceTimersByTime(COOLDOWN_MS);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("forgets a closed panel", () => {
    const fire = vi.fn(() => true);
    const w = new Watches(fire);
    w.handle("p1", [question]);
    w.forget("p1");
    vi.advanceTimersByTime(GRACE_MS);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("events for watches", () => {
  it("keeps the questions of a dialog, from Claude Code and from pi", () => {
    const tool_input = { questions: [{ question: "Which colour?", header: "Colour", options: [{ label: "Blue", description: "b" }, { label: "Green" }], multiSelect: false }] };
    const expected = [{ kind: "waiting", reason: "question", questions: [{ question: "Which colour?", options: ["Blue", "Green"] }] }];
    expect(fromClaude("PreToolUse", { tool_name: "AskUserQuestion", tool_input })).toEqual(expected);
    // pi: the extension sends the input of the tool that was running when the dialog opened.
    expect(fromPi("ui_prompt_start", { title: "", kind: "custom", input: tool_input })).toEqual(expected);
  });

  it("reads pi questions by their shape, whatever the tool is called, open ones included", () => {
    const one = fromPi("ui_prompt_start", { kind: "custom", input: { question: "Deploy to staging or production?", choices: ["staging", { value: "production" }] } });
    expect(one).toEqual([{ kind: "waiting", reason: "question", questions: [{ question: "Deploy to staging or production?", options: ["staging", "production"] }] }]);
    const open = fromPi("ui_prompt_start", { kind: "input", input: { question: "How should I continue?" } });
    expect(open).toEqual([{ kind: "waiting", reason: "question", questions: [{ question: "How should I continue?", options: [] }] }]);
  });

  it("doesn't take a tool with a question for a question to the user unless a dialog opens", () => {
    // A tool that asks something else (here another model): no dialog, so it's just a tool.
    expect(fromPi("tool", { tool: "ask_expert", input: { question: "What does EPERM mean?" } })).toEqual([{ kind: "tool", tool: "ask_expert", files: [], edit: false }]);
    // An approval extension's dialog while a write runs: no questions in that input, so it stays unknown.
    expect(fromPi("ui_prompt_start", { title: "Approve write to notes.txt?", kind: "confirm", input: undefined })).toEqual([{ kind: "waiting", reason: "Approve write to notes.txt?" }]);
  });

  it("keeps the end of a long final message", () => {
    const text = "start ".repeat(500) + "Should I go on?";
    const [e] = fromClaude("Stop", { last_assistant_message: text });
    expect(e.kind === "turn_end" && e.text.startsWith("start") && e.text.endsWith("Should I go on?")).toBe(true);
    expect(e.kind === "turn_end" && e.text.length).toBeLessThan(2100);
  });
});

describe("Coordinators", () => {
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  beforeEach(() => settings.set("defaultModel", refOf(faux.getModel())));
  startWatches();

  it("makes a project's one Sprocket its Coordinator (ADR 0016)", () => {
    const project = projects.create("app", `/work/coord-${Math.random()}`);
    const other = projects.create("lib", `/work/coord-${Math.random()}`);
    const a = createSprocket({ name: "A", look });
    const b = createSprocket({ name: "B", look });
    expect(updateSettings(a.id, { projectId: project.id }).coordinator).toBe(true);
    expect(() => updateSettings(b.id, { projectId: project.id })).toThrow("A already looks after app. Detach it first.");
    expect(updateSettings(a.id, { projectId: other.id }).coordinator).toBe(true); // it moved, still a Coordinator
    expect(updateSettings(b.id, { projectId: project.id }).coordinator).toBe(true); // the project is free again
    expect(updateSettings(a.id, { projectId: null }).coordinator).toBe(false);
  });

  it("puts a waiting session in the Coordinator's chat and wakes it", async () => {
    const project = projects.create("app", `/work/coord-${Math.random()}`);
    const s = createSprocket({ name: "Lead", look });
    updateSettings(s.id, { projectId: project.id });
    const p = panels.create({ projectId: project.id, kind: "claude", title: "Fix sidebar", sessionId: `c-${Math.random()}` });
    faux.setResponses([fauxAssistantMessage("Fix sidebar asks whether to update the tests. I'd say yes.")]);

    vi.useFakeTimers();
    receive(p.id, "claude", "Stop", { last_assistant_message: "Fixed it. Should I also update the tests?" });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(projectChat(s.id)).length).toBeGreaterThan(0));
    await idle();

    const [event, reply] = listMessages(projectChat(s.id));
    expect(event.author).toBe("event");
    expect(event.text).toBe("Fixed it. Should I also update the tests?");
    expect(event.event).toEqual({ panelId: p.id, kind: "claude", title: "Fix sidebar", sessionId: p.sessionId, what: "turn_end" });
    expect(reply.text).toBe("Fix sidebar asks whether to update the tests. I'd say yes.");
  });

  it("marks an event quiet when the Coordinator finds nothing for the user", async () => {
    const project = projects.create("app", `/work/coord-${Math.random()}`);
    const s = createSprocket({ name: "Lead", look });
    updateSettings(s.id, { projectId: project.id });
    const p = panels.create({ projectId: project.id, kind: "pi", title: "Docs" });
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage("(quiet)");
      },
    ]);

    vi.useFakeTimers();
    receive(p.id, "pi", "agent_end", { text: "Done. Should I also clear the cache?" });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(projectChat(s.id)).length).toBeGreaterThan(0));
    await idle();

    expect(prompt).toContain("[Rails event, not from your user]");
    expect(prompt).toContain('\\"Docs\\" (pi, id');
    const list = listMessages(projectChat(s.id));
    expect(list.map((m) => m.author)).toEqual(["event"]);
    expect(list[0].event?.quiet).toBe(true);
  });

  it("marks it quiet too when the Coordinator explains first and ends with (quiet)", async () => {
    const project = projects.create("app", `/work/coord-${Math.random()}`);
    const s = createSprocket({ name: "Lead", look });
    updateSettings(s.id, { projectId: project.id });
    const p = panels.create({ projectId: project.id, kind: "pi", title: "Docs" });
    faux.setResponses([fauxAssistantMessage("It only asks out of habit; the cache was cleared already. (quiet)")]);

    vi.useFakeTimers();
    receive(p.id, "pi", "agent_end", { text: "Done. Should I also clear the cache?" });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(projectChat(s.id)).length).toBeGreaterThan(0));
    await idle();

    const list = listMessages(projectChat(s.id));
    expect(list.map((m) => m.author)).toEqual(["event"]);
    expect(list[0].event?.quiet).toBe(true);
  });

  it("wakes nobody in a project without a Sprocket", () => {
    const project = projects.create("app", `/work/coord-${Math.random()}`);
    const s = createSprocket({ name: "Helper", look }); // not attached
    const p = panels.create({ projectId: project.id, kind: "claude", title: "X" });
    vi.useFakeTimers();
    receive(p.id, "claude", "Stop", { last_assistant_message: "Should I go on?" });
    vi.advanceTimersByTime(GRACE_MS);
    vi.useRealTimers();
    expect(listMessages(directChat(s.id))).toEqual([]);
  });
});
