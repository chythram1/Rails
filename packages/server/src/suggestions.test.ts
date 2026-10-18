import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CodexWatcher } from "./bridge/codex.ts";
import { PiInbox } from "./bridge/deliver.ts";
import { receive } from "./bridge/index.ts";
import { panels, projects, settings } from "./db.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, listMessages, sendMessage, updateSettings } from "./sprockets.ts";
import { dismissSuggestion, sendSuggestion, startSuggestions, suggest } from "./suggestions.ts";

const look = { character: "bell", color: "purple", accessory: "none" } as const;
const faux = fauxProvider();
models.setProvider(faux.provider);
beforeEach(() => settings.set("defaultModel", refOf(faux.getModel())));
startSuggestions();

// A stand-in for Claude Code's message socket: it keeps what it's sent.
const dir = mkdtempSync(join(tmpdir(), "rails-inbox-"));
const inbox = join(dir, "claude.sock");
const received: string[] = [];
const server = net.createServer((s) => {
  let data = "";
  s.on("data", (d) => (data += d));
  s.on("end", () => received.push(data));
});
await new Promise<void>((r) => server.listen(inbox, r));
afterAll(() => server.close());

/** A project with a Coordinator and a Claude Code session whose turn ended with a question. */
function setup() {
  const project = projects.create("app", `/work/sugg-${Math.random()}`);
  const lead = createSprocket({ name: "Lead", look });
  updateSettings(lead.id, { projectId: project.id, coordinator: true });
  const sessionId = `c-${Math.random()}`;
  const panel = panels.create({ projectId: project.id, kind: "claude", title: "Fix sidebar", sessionId });
  receive(panel.id, "claude", "SessionStart", { session_id: sessionId }, { inbox });
  receive(panel.id, "claude", "Stop", { session_id: sessionId, last_assistant_message: "Fixed. Should I also update the tests?" });
  return { project, lead, panel };
}

/** The Coordinator, asked in its chat, suggests `reply` for the panel through a codemode script. */
async function suggestThroughRun(leadId: string, panelId: string, reply: string, after = "Fix sidebar asks about the tests; I'd say yes.") {
  const code = `return await tools.suggest_reply({ session: ${JSON.stringify(panelId.slice(0, 8))}, reply: ${JSON.stringify(reply)} })`;
  faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }), fauxAssistantMessage(after)]);
  sendMessage(leadId, "what should I tell it?");
  await idle();
  return listMessages(leadId).at(-1)!;
}

describe("suggested replies", () => {
  it("shows a Coordinator's suggestion under its reply, and sends it (edited) into Claude Code", async () => {
    const { lead, panel } = setup();
    const reply = await suggestThroughRun(lead.id, panel.id, "Yes, update the tests.");
    expect(reply.author).toBe("sprocket");
    expect(reply.activity).toBe("Drafted a reply");
    const [s] = reply.suggestions!;
    expect(s).toMatchObject({ panelId: panel.id, kind: "claude", title: "Fix sidebar", mode: "reply", text: "Yes, update the tests.", status: "pending" });

    const sent = await sendSuggestion(s.id, "  Yes, and run them too.  ");
    expect(sent).toMatchObject({ status: "sent", text: "Yes, and run them too." });
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(received.at(-1)!)).toEqual({ type: "user", message: { role: "user", content: "From your user, sent with Rails:\nYes, and run them too." } });
    await expect(sendSuggestion(s.id, "again")).rejects.toThrow("already sent");
    // The session starting its next turn doesn't touch what was sent.
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "Yes, and run them too." });
    expect(listMessages(lead.id).at(-1)!.suggestions![0].status).toBe("sent");
  });

  it("expires a suggestion when the session moves on, and refuses to send it", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "never mind, I'll do it" });
    expect(listMessages(lead.id).at(-1)!.suggestions![0].status).toBe("expired");
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("can't be sent anymore");
  });

  it("re-checks the session when the user sends", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    receive(panel.id, "claude", "PermissionRequest", { tool_name: "Bash" }); // (as if a turn had started unseen)
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("waiting for you in its panel");
    expect(listMessages(lead.id).at(-1)!.suggestions![0].status).toBe("expired");
  });

  it("lets the user dismiss a suggestion", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    expect(dismissSuggestion(s.id).status).toBe("dismissed");
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("can't be sent anymore");
  });

  it("suggests an answer for a dialog, which the user picks in the panel", async () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which colour?", options: [{ label: "Green" }] }] } });
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Green")).suggestions!;
    expect(s.mode).toBe("answer");
    await expect(sendSuggestion(s.id, "Green")).rejects.toThrow("Answer it in the session's panel.");
    receive(panel.id, "claude", "PostToolUse", { tool_name: "AskUserQuestion", tool_input: {} }); // answered there
    expect(listMessages(lead.id).at(-1)!.suggestions![0].status).toBe("expired");
  });

  it("never suggests for a permission prompt, an extension's dialog or a working session", () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "go" });
    expect(() => suggest(lead.id, panel, "Fix sidebar", "ok")).toThrow("is working right now");
    receive(panel.id, "claude", "PermissionRequest", { tool_name: "Bash" });
    expect(() => suggest(lead.id, panel, "Fix sidebar", "yes")).toThrow("only your user gives");
    const pi = panels.create({ projectId: panel.projectId, kind: "pi", title: "Notes" });
    receive(pi.id, "pi", "ui_prompt_start", { title: "Approve write to notes.txt?" });
    expect(() => suggest(lead.id, pi, "Notes", "Yes")).toThrow("only your user gives");
  });

  it("keeps a question a question when its dialog is reported again", async () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which colour?", options: [] }] } });
    receive(panel.id, "claude", "PermissionRequest", { tool_name: "AskUserQuestion" });
    expect(suggest(lead.id, panel, "Fix sidebar", "Green").mode).toBe("answer");
    const pi = panels.create({ projectId: panel.projectId, kind: "pi", title: "Notes" });
    receive(pi.id, "pi", "tool", { tool: "ask_user_question", input: { questions: [{ question: "Which colour?", options: [] }] } });
    receive(pi.id, "pi", "ui_prompt_start", { title: "" });
    expect(suggest(lead.id, pi, "Notes", "Green").mode).toBe("answer");
  });

  it("replaces a session's earlier suggestion with a newer one", async () => {
    const { lead, panel } = setup();
    await suggestThroughRun(lead.id, panel.id, "Yes.");
    await suggestThroughRun(lead.id, panel.id, "Yes, but skip the e2e tests.");
    const shown = listMessages(lead.id).flatMap((m) => m.suggestions ?? []);
    expect(shown.map((s) => [s.text, s.status])).toEqual([
      ["Yes.", "expired"],
      ["Yes, but skip the e2e tests.", "pending"],
    ]);
    expect(shown[0].error).toBe("A newer suggestion replaced it.");
  });

  it("only lets the project's Coordinator suggest", async () => {
    const { project, lead, panel } = setup();
    const helper = createSprocket({ name: "Helper", look });
    updateSettings(helper.id, { projectId: project.id });
    const code = `return await tools.suggest_reply({ session: ${JSON.stringify(panel.id.slice(0, 8))}, reply: "Yes." })`;
    faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }), fauxAssistantMessage("I can't.")]);
    sendMessage(helper.id, "tell it yes");
    await idle();
    expect(listMessages(helper.id).at(-1)!.suggestions).toBeUndefined();
    // The role is checked when the capability runs: a Coordinator that lost it mid-run can't suggest either.
    updateSettings(lead.id, { coordinator: false });
    expect(listMessages(lead.id)).toEqual([]);
  });

  it("drops suggestions from a run that saved no reply", async () => {
    const { lead, panel } = setup();
    const reply = await suggestThroughRun(lead.id, panel.id, "Yes.", "");
    expect(reply.author).toBe("notice");
    expect(listMessages(lead.id).some((m) => m.suggestions)).toBe(false);
  });
});

describe("delivery", () => {
  it("hands a reply to the pi extension's poll, and counts it sent only when pi took it", async () => {
    const box = new PiInbox();
    const poll = box.poll("p1", new AbortController().signal);
    const sent = box.hand("p1", "hello");
    const [m] = await poll;
    expect(m.text).toBe("hello");
    box.ack("other", m.id, true); // another panel can't answer for it
    box.ack("p1", m.id, true);
    await expect(sent).resolves.toBeUndefined();
    await expect(box.hand("p1", "again", { takeMs: 150 })).rejects.toThrow("Rails can't reach this pi session");
  });

  it("fails a pi reply the extension turned down (pi was busy) or never confirmed", async () => {
    const box = new PiInbox();
    let poll = box.poll("p1", new AbortController().signal);
    const busy = box.hand("p1", "hello");
    box.ack("p1", (await poll)[0].id, false);
    await expect(busy).rejects.toThrow("pi started working on something else");
    poll = box.poll("p1", new AbortController().signal);
    const lost = box.hand("p1", "hello", { ackMs: 30 });
    await poll; // answered, but the extension never says it got it (the connection dropped)
    await expect(lost).rejects.toThrow("pi didn't confirm it got the message");
  });

  it("answers a pi poll empty when it times out or is dropped, and lets a newer poll take over", async () => {
    const box = new PiInbox();
    expect(await box.poll("p1", new AbortController().signal, 20)).toEqual([]);
    const gone = new AbortController();
    const first = box.poll("p1", gone.signal);
    const second = box.poll("p1", new AbortController().signal);
    expect(await first).toEqual([]);
    const sent = box.hand("p1", "hi");
    const [m] = await second;
    expect(m.text).toBe("hi");
    box.ack("p1", m.id, true);
    await sent;
  });

  it("queues a reply on a Codex thread", async () => {
    const sent: any[] = [];
    const watcher = new CodexWatcher((m) => sent.push(m), () => {});
    const done = watcher.queue("t1", "Yes, go on.");
    const msg = sent.at(-1);
    expect(msg).toMatchObject({ method: "thread/queue/add", params: { threadId: "t1", input: [{ type: "text", text: "Yes, go on." }] } });
    expect(typeof msg.params.clientUserMessageId).toBe("string");
    watcher.handle({ id: msg.id, result: { queuedSubmission: {} } });
    await expect(done).resolves.toBeUndefined();
    const refused = watcher.queue("t1", "x");
    watcher.handle({ id: sent.at(-1).id, error: { message: "no such thread" } });
    await expect(refused).rejects.toThrow("Codex refused the message: no such thread");
  });
});
