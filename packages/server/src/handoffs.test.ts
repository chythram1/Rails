import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPanel, receive } from "./bridge/index.ts";
import { handoffs, panels, projects, settings } from "./db.ts";
import { cancelHandoff, expireHandoffs, HANDOFF_TTL_MS, MAX_HANDOFFS, planHandoff, startHandoffs } from "./handoffs.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, deleteSprocket, listMessages, listSprockets, sendMessage, updateSettings } from "./sprockets.ts";
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
  updateSettings(lead.id, { projectId: project.id, coordinator: true });
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
    sendMessage(lead.id, "When auth is done, tell the UI session to use the new /login endpoint.");
    await idle();
    expect(pending()).toEqual([expect.objectContaining({ from: expect.objectContaining({ panelId: auth.id }), note: "Tell it to use the new /login endpoint." })]);
    sendMessage(lead.id, "Anything waiting?");
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
    await vi.waitFor(() => expect(listMessages(lead.id).length).toBeGreaterThan(0));
    await idle();

    const [event, reply] = listMessages(lead.id);
    expect(event.event).toMatchObject({ panelId: auth.id, what: "handoff", handoff: { id: h.id, to: { panelId: ui.id, kind: "pi", title: "UI" }, note: h.note } });
    expect(event.text).toBe("Done: /login now issues tokens.");
    expect(prompt).toContain(`passing handoff: \\"${h.id.slice(0, 8)}\\"`);
    expect(reply.suggestions?.[0]).toMatchObject({ panelId: ui.id, mode: "message", text: "Auth is done: use the new /login endpoint." });
    expect(pending()).toEqual([]);
  });

  it("waits for the next turn end when the Coordinator finds the work isn't done", async () => {
    const { lead, auth, plan, pending } = setup();
    plan();
    faux.setResponses([fauxAssistantMessage("(quiet)")]);
    receive(auth.id, "claude", "Stop", { last_assistant_message: "Half way there." });
    await vi.waitFor(() => expect(listMessages(lead.id).length).toBeGreaterThan(0));
    await idle();
    expect(listMessages(lead.id)[0].event?.quiet).toBe(true);
    expect(pending()).toHaveLength(1);
  });
});

describe("handoffs that can't happen", () => {
  const notices = (id: string) => listMessages(id).filter((m) => m.author === "notice").map((m) => m.text);

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
    sendMessage(lead.id, "Pass it on now.");
    await idle();
    expect(result).toContain("No pending handoff");
    expect(listMessages(lead.id).at(-1)!.suggestions ?? []).toEqual([]);
    expect(pending()).toEqual([]);
  });

  it("end when their Sprocket stops being the Coordinator: switched off, replaced, moved or deleted", () => {
    const { lead, plan, pending } = setup();
    const project = listSprockets().find((s) => s.id === lead.id)!.projectId!;
    const ended = () => notices(lead.id).filter((t) => t.endsWith("isn't the project's Coordinator anymore."));

    plan();
    updateSettings(lead.id, { coordinator: false });
    expect(pending()).toEqual([]);
    expect(ended()).toHaveLength(1);

    updateSettings(lead.id, { coordinator: true });
    plan();
    const other = createSprocket({ name: "Other", look });
    updateSettings(other.id, { projectId: project, coordinator: true }); // takes over
    expect(pending()).toEqual([]);
    expect(ended()).toHaveLength(2);

    updateSettings(lead.id, { coordinator: true });
    plan();
    const elsewhere = projects.create("lib", `/work/handoff-${Math.random()}`);
    updateSettings(lead.id, { projectId: elsewhere.id, coordinator: true }); // Coordinator there now, not here
    expect(handoffs.pending(lead.id)).toEqual([]);
    expect(listMessages(lead.id)).toEqual([]); // its chat went with the move: nothing to say there

    updateSettings(lead.id, { projectId: project, coordinator: true });
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
