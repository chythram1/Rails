import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromCodex } from "./bridge/events.ts";
import { forgetPanel, receive, record } from "./bridge/index.ts";
import { handoffs, panels, projects, settings } from "./db.ts";
import { cancelHandoff, expireHandoffs, HANDOFF_TTL_MS, MAX_HANDOFFS, planHandoff, startHandoffs } from "./handoffs.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, deleteSprocket, listMessages, listSprockets, projectChat, sendMessage, updateSettings } from "./sprockets.ts";
import { deliveredText } from "./suggestions.ts";
import { messageFromAgent } from "./agentTools.ts";
import { startWatches } from "./watches.ts";

const look = { character: "cog", color: "green", accessory: "none" } as const;
const faux = fauxProvider();
models.setProvider(faux.provider);
beforeEach(() => settings.set("defaultModel", refOf(faux.getModel())));
afterEach(() => vi.useRealTimers());
startWatches();
startHandoffs();

/** A project with a Coordinator, an auth session (Claude Code) and a UI session (pi). */
function setup() {
  const project = projects.create("app", `/work/handoff-${Math.random()}`);
  const lead = createSprocket({ name: "Lead", look });
  updateSettings(lead.id, { projectId: project.id });
  const auth = panels.create({ projectId: project.id, kind: "claude", title: "Auth", sessionId: `a-${Math.random()}` });
  const ui = panels.create({ projectId: project.id, kind: "pi", title: "UI" });
  const plan = (note = "Use the new /login endpoint.") => planHandoff(lead.id, { panel: auth, title: "Auth" }, { panel: ui, title: "UI" }, note);
  const pending = () => listSprockets().find((s) => s.id === lead.id)!.handoffs;
  return { lead, auth, ui, plan, pending };
}

describe("planning handoffs", () => {
  it("checks what it's given", () => {
    const { lead, auth, ui, plan, pending } = setup();
    expect(() => plan("  ")).toThrow("Say what to pass on");
    expect(() => plan("x".repeat(301))).toThrow("at most 300 characters");
    expect(() => planHandoff(lead.id, { panel: auth, title: "Auth" }, { panel: auth, title: "Auth" }, "hi")).toThrow("from one session to another");
    receive(ui.id, "pi", "session_shutdown", {});
    expect(() => plan()).toThrow('"UI" has ended.');
    receive(ui.id, "pi", "session_start", { sessionId: "u2" });
    for (let i = 0; i < MAX_HANDOFFS; i++) plan(`note ${i}`);
    expect(() => plan()).toThrow(`You have ${MAX_HANDOFFS} handoffs waiting`);
    expect(pending()).toHaveLength(MAX_HANDOFFS);
    expect(pending()[0]).toMatchObject({ from: { panelId: auth.id, kind: "claude", title: "Auth" }, to: { panelId: ui.id, kind: "pi", title: "UI" }, note: "note 0" });
  });

  it("lets a Coordinator plan one from the chat, and lists it in its instructions", async () => {
    const { lead, auth, ui, pending } = setup();
    const code = `return await tools.plan_handoff({ from: "Auth", to: ${JSON.stringify(ui.id.slice(0, 8))}, note: "Tell it to use the new /login endpoint." })`;
    let system = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
      fauxAssistantMessage("I'll pass it on when Auth is done."),
      (context) => {
        system = JSON.stringify(context.messages.filter((m) => (m.role as string) === "system"));
        return fauxAssistantMessage("One handoff is waiting.");
      },
    ]);
    sendMessage(projectChat(lead.id), "When auth is done, tell the UI session to use the new /login endpoint.");
    await idle();
    expect(pending()).toEqual([expect.objectContaining({ from: expect.objectContaining({ panelId: auth.id }), note: "Tell it to use the new /login endpoint." })]);
    sendMessage(projectChat(lead.id), "Anything waiting?");
    await idle();
    expect(system).toContain(`- ${pending()[0].id.slice(0, 8)}: when \\"Auth\\" (id ${auth.id.slice(0, 8)}) is done, for \\"UI\\"`);
  });
});

describe("a handoff's session finishing", () => {
  it("wakes the Coordinator, which drafts the message and so carries it out", async () => {
    const { lead, auth, ui, plan, pending } = setup();
    const h = plan();
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        const code = `return await tools.suggest_message({ session: "whatever", handoff: ${JSON.stringify(h.id.slice(0, 8))}, message: "Auth is done: use the new /login endpoint." })`;
        return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("Auth is done; I drafted the message for UI."),
    ]);
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Should I add tests too?" }); // asks: not finished
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Done: /login now issues tokens." });
    await vi.waitFor(() => expect(listMessages(projectChat(lead.id)).length).toBeGreaterThan(0));
    await idle();

    const [event, reply] = listMessages(projectChat(lead.id));
    expect(event.event).toMatchObject({ panelId: auth.id, what: "handoff", handoff: { id: h.id, to: { panelId: ui.id, kind: "pi", title: "UI" }, note: h.note } });
    expect(event.text).toBe("Done: /login now issues tokens.");
    expect(prompt).toContain(`passing handoff: \\"${h.id.slice(0, 8)}\\"`);
    expect(reply.suggestions?.[0]).toMatchObject({
      panelId: ui.id,
      mode: "message",
      text: "Auth is done: use the new /login endpoint.",
      attachment: { title: "Auth", text: "Done: /login now issues tokens." }, // its own words, not a summary
    });
    expect(deliveredText(reply.suggestions![0].text, reply.suggestions![0].attachment)).toBe(
      'Auth is done: use the new /login endpoint.\n\n---\nWhat "Auth" said when it finished, word for word:\n\nDone: /login now issues tokens.',
    );
    expect(pending()).toEqual([]);
  });

  it("waits when the user stops a turn: stopped isn't finished", async () => {
    const { lead, auth, ui, pending } = setup();
    const codex = panels.create({ projectId: panels.get(auth.id)!.projectId, kind: "codex", title: "Codex", sessionId: `t-${Math.random()}` });
    planHandoff(lead.id, { panel: codex, title: "Codex" }, { panel: auth, title: "Auth" }, "Pass it on.");
    planHandoff(lead.id, { panel: ui, title: "UI" }, { panel: auth, title: "Auth" }, "Pass it on too.");
    record(codex.id, fromCodex("turn/completed", { turn: { status: "interrupted", items: [] } })); // Codex, Escape
    receive(ui.id, "pi", "agent_end", { aborted: true }); // pi, Escape
    await new Promise((r) => setTimeout(r, 50));
    expect(listMessages(projectChat(lead.id)).filter((m) => m.author === "event")).toEqual([]);
    expect(pending()).toHaveLength(2);
  });

  it("waits for the next turn end when the Coordinator finds the work isn't done", async () => {
    const { lead, auth, plan, pending } = setup();
    plan();
    faux.setResponses([fauxAssistantMessage("(quiet)")]);
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Half way there." });
    await vi.waitFor(() => expect(listMessages(projectChat(lead.id)).length).toBeGreaterThan(0));
    await idle();
    expect(listMessages(projectChat(lead.id))[0].event?.quiet).toBe(true);
    expect(pending()).toHaveLength(1);
  });
});

describe("handoff titles", () => {
  it("follow their sessions: a handoff is often planned before a session has a title", async () => {
    const { auth, ui, plan, pending } = setup();
    const project = projects.get(panels.get(auth.id)!.projectId)!;
    const sid = `c-${Math.random()}`;
    panels.setSession(auth.id, sid);
    plan();
    expect(pending()[0].from.title).toBe("Auth");
    // Discovery now knows the session by Claude Code's own title.
    const dir = join(process.env.CLAUDE_HOME!, "projects", "handoff-titles");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sid}.jsonl`), [{ type: "user", cwd: project.path, sessionId: sid, timestamp: new Date().toISOString(), message: { role: "user", content: "go" } }, { type: "ai-title", aiTitle: "Login endpoint" }].map((l) => JSON.stringify(l)).join("\n") + "\n");
    receive(auth.id, "claude", "UserPromptSubmit", { prompt: "go" });
    await vi.waitFor(() => expect(pending()[0].from.title).toBe("Login endpoint"));
    expect(pending()[0].to.title).toBe("UI");
  });
});

describe("handoffs that can't happen", () => {
  const notices = (id: string) => listMessages(projectChat(id)).filter((m) => m.author === "notice").map((m) => m.text);

  it("are cancelled when a session ends or a panel closes, with a line in the chat", () => {
    const { lead, auth, ui, plan, pending } = setup();
    plan();
    receive(ui.id, "pi", "session_shutdown", {});
    expect(pending()).toEqual([]);
    receive(ui.id, "pi", "session_start", { sessionId: "u2" });
    plan();
    panels.remove(auth.id);
    forgetPanel(auth.id);
    expect(pending()).toEqual([]);
    expect(notices(lead.id)).toEqual(["Handoff from \u201cAuth\u201d to \u201cUI\u201d cancelled: \u201cUI\u201d ended.", "Handoff from \u201cAuth\u201d to \u201cUI\u201d cancelled: \u201cAuth\u201d was closed first."]);
  });

  it("are cancelled when a session that was in use moves on to another in its panel (/clear, resuming another)", async () => {
    const { lead, auth, plan, pending } = setup();
    const h = plan();
    expect(h.from.sessionId).toBe(auth.sessionId);
    receive(auth.id, "claude", "UserPromptSubmit", { session_id: auth.sessionId, prompt: "Build the login" });
    receive(auth.id, "claude", "SessionStart", { session_id: "a-cleared", source: "clear" });
    expect(pending()).toEqual([]);
    expect(notices(lead.id)).toEqual(["Handoff from \u201cAuth\u201d to \u201cUI\u201d cancelled: \u201cAuth\u201d moved on to another session."]);
    // The new session finishing a turn isn't what the handoff waited for: nothing wakes.
    receive(auth.id, "claude", "Stop", { session_id: "a-cleared", last_assistant_message: "Done: something else." });
    await idle();
    expect(listMessages(projectChat(lead.id)).filter((m) => m.author === "event")).toEqual([]);
  });

  it("follow a session that started after they were planned, or replaced one that never had a turn", () => {
    const { auth, ui, plan, pending } = setup();
    plan();
    expect(pending()[0].to.sessionId).toBeUndefined();
    receive(ui.id, "pi", "session_start", { sessionId: "u1" }); // the UI session's id becomes known
    expect(pending()[0].to.sessionId).toBe("u1");
    // Codex can start a thread it never uses and Rails moves the panel to the real one (bridge/codex.ts): a
    // session that hasn't had a turn is replaced, not left.
    receive(auth.id, "claude", "SessionStart", { session_id: "a-real", source: "startup" });
    expect(pending()).toHaveLength(1);
    expect(pending()[0].from.sessionId).toBe("a-real");
  });

  it("expire after a day", () => {
    vi.useFakeTimers();
    const { lead, plan, pending } = setup();
    plan();
    vi.setSystemTime(Date.now() + HANDOFF_TTL_MS);
    expireHandoffs();
    expect(pending()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 1);
    expireHandoffs();
    expect(pending()).toEqual([]);
    expect(notices(lead.id)).toEqual(["Handoff from \u201cAuth\u201d to \u201cUI\u201d expired: \u201cAuth\u201d didn't finish within a day."]);
  });

  it("show what the receiving session said at the end of its own last turn", async () => {
    const { auth, ui, plan } = setup();
    plan();
    receive(ui.id, "pi", "prompt", { text: "Switch to the new login" });
    receive(ui.id, "pi", "agent_end", { text: "The UI already calls /login." }); // runs 7 and 8: it had done it
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage("(quiet)");
      },
    ]);
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Done: /login now issues tokens." });
    await vi.waitFor(() => expect(prompt).not.toBe(""));
    await idle();
    expect(prompt).toContain("ended a turn of its own lately");
    expect(prompt).toContain("The UI already calls /login.");
  });

  it("refuse to repeat what the finished session already wrote to the other, unless it adds what's missing", async () => {
    const { lead, auth, ui, plan, pending } = setup();
    const h = plan();
    await messageFromAgent(auth.id, ui.id.slice(0, 8), "Use /login now: it returns { token }.");
    const send = (extra: string) => `return await tools.suggest_message({ session: "x", handoff: ${JSON.stringify(h.id.slice(0, 8))}, message: "Use /login."${extra} })`;
    let prompt = "";
    let refused = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage([fauxToolCall("codemode", { code: send("") })], { stopReason: "toolUse" });
      },
      (context) => {
        refused = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage([fauxToolCall("codemode", { code: send(", missing: true") })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("Drafted only what was missing."),
    ]);
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Done: /login now issues tokens." });
    await vi.waitFor(() => expect(refused).not.toBe(""));
    await idle();
    expect(prompt).toContain("it has written to");
    expect(refused).toContain("already wrote to");
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions?.[0]).toMatchObject({ panelId: ui.id, text: "Use /login." });
    expect(pending()).toEqual([]);
  });

  it("get no message once cancelled, even if the Coordinator still tries", async () => {
    const { lead, plan, pending } = setup();
    const h = plan();
    cancelHandoff(h.id);
    const code = `return await tools.suggest_message({ session: "x", handoff: ${JSON.stringify(h.id.slice(0, 8))}, message: "Go." })`;
    let result = "";
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
      (context) => {
        result = JSON.stringify(context.messages.at(-1)?.content);
        return fauxAssistantMessage("It was cancelled.");
      },
    ]);
    sendMessage(projectChat(lead.id), "Pass it on now.");
    await idle();
    expect(result).toContain("No pending handoff");
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions ?? []).toEqual([]);
    expect(pending()).toEqual([]);
  });

  it("end when their Sprocket leaves the project: moved, detached or deleted", () => {
    const { lead, plan } = setup();
    const project = listSprockets().find((s) => s.id === lead.id)!.projectId!;

    plan();
    const elsewhere = projects.create("lib", `/work/handoff-${Math.random()}`);
    updateSettings(lead.id, { projectId: elsewhere.id });
    expect(handoffs.pending(lead.id)).toEqual([]);
    expect(listMessages(projectChat(lead.id))).toEqual([]); // its project chat went with the move: nothing to say there

    updateSettings(lead.id, { projectId: project });
    plan();
    updateSettings(lead.id, { projectId: null });
    expect(handoffs.pending(lead.id)).toEqual([]);

    updateSettings(lead.id, { projectId: project });
    plan();
    deleteSprocket(lead.id);
    expect(handoffs.pending(lead.id)).toEqual([]);
  });

  it("can be cancelled by the user, once", () => {
    const { lead, plan, pending } = setup();
    const h = plan();
    cancelHandoff(h.id);
    expect(pending()).toEqual([]);
    expect(() => cancelHandoff(h.id)).toThrow("isn't waiting anymore");
    expect(notices(lead.id)).toEqual([]); // the user did it: nothing to tell them
  });
});
