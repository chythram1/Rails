import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CodexWatcher } from "./bridge/codex.ts";
import { claudeInbox, PiInbox, piInbox } from "./bridge/deliver.ts";
import { receive, record } from "./bridge/index.ts";
import { fromCodex } from "./bridge/events.ts";
import { panels, projects, settings, sprocketMessages, suggestions } from "./db.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, directChat, listMessages, listSprockets, projectChat, sendMessage, updateSettings } from "./sprockets.ts";
import { dialogAnswer, dismissSuggestion, pickup, sendSuggestion, startSuggestions, suggest } from "./suggestions.ts";

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
  updateSettings(lead.id, { projectId: project.id });
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
  sendMessage(projectChat(leadId), "what should I tell it?");
  await idle();
  return listMessages(projectChat(leadId)).at(-1)!;
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
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].status).toBe("sent");
  });

  it("expires a suggestion when the session moves on, and refuses to send it", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "never mind, I'll do it" });
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].status).toBe("expired");
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("can't be sent anymore");
  });

  it("re-checks the session when the user sends", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    receive(panel.id, "claude", "PermissionRequest", { tool_name: "Bash" }); // (as if a turn had started unseen)
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("waiting for you in its panel");
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].status).toBe("expired");
  });

  it("lets the user dismiss a suggestion", async () => {
    const { lead, panel } = setup();
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Yes.")).suggestions!;
    const pending = () => listSprockets().find((x) => x.id === lead.id)!.pending;
    expect(pending()).toEqual([panel.id]); // the workspace marks the session's tab
    expect(dismissSuggestion(s.id).status).toBe("dismissed");
    expect(pending()).toEqual([]);
    await expect(sendSuggestion(s.id, "Yes.")).rejects.toThrow("can't be sent anymore");
  });

  it("suggests an answer for a dialog, which the user picks in the panel", async () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which colour?", options: [{ label: "Green" }] }] } });
    const [s] = (await suggestThroughRun(lead.id, panel.id, "Green")).suggestions!;
    expect(s.mode).toBe("answer");
    await expect(sendSuggestion(s.id, "Green")).rejects.toThrow("Answer it in the session's panel.");
    receive(panel.id, "claude", "PostToolUse", { tool_name: "AskUserQuestion", tool_input: {} }); // answered there
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].status).toBe("expired");
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
    const input = { questions: [{ question: "Which colour?", options: [] }] };
    receive(pi.id, "pi", "tool", { tool: "ask_user_question", input });
    receive(pi.id, "pi", "ui_prompt_start", { title: "", kind: "custom", input });
    expect(suggest(lead.id, pi, "Notes", "Green").mode).toBe("answer");
  });

  it("keeps a session's messages side by side, up to a limit, and an answer apart from them", () => {
    const { lead, panel } = setup();
    for (const t of ["Heads-up: auth.ts changed.", "Handoff: use /login.", "Also: rerun the tests."]) suggest(lead.id, panel, "Fix sidebar", t, { purpose: "message" });
    expect(() => suggest(lead.id, panel, "Fix sidebar", "One more.", { purpose: "message" })).toThrow("3 of your messages");
    const answer = suggest(lead.id, panel, "Fix sidebar", "Yes.");
    suggest(lead.id, panel, "Fix sidebar", "Yes, and skip e2e."); // replaces the answer, not the messages
    const pending = suggestions.pendingFor(panel.id).map((s) => s.text);
    expect(pending).toEqual(["Heads-up: auth.ts changed.", "Handoff: use /login.", "Also: rerun the tests.", "Yes, and skip e2e."]);
    expect(suggestions.get(answer.id)).toBeUndefined(); // never shown (no reply yet), so dropped
  });

  it("replaces a session's earlier answer with a newer one", async () => {
    const { lead, panel } = setup();
    await suggestThroughRun(lead.id, panel.id, "Yes.");
    await suggestThroughRun(lead.id, panel.id, "Yes, but skip the e2e tests.");
    const shown = listMessages(projectChat(lead.id)).flatMap((m) => m.suggestions ?? []);
    expect(shown.map((s) => [s.text, s.status])).toEqual([
      ["Yes.", "replaced"],
      ["Yes, but skip the e2e tests.", "pending"],
    ]);
  });

  it("only lets the project's own Sprocket suggest", async () => {
    const { project, lead } = setup();
    const helper = createSprocket({ name: "Helper", look });
    expect(() => updateSettings(helper.id, { projectId: project.id })).toThrow("Lead already looks after app. Detach it first.");
    // Unattached, it has no project and no capabilities to suggest with.
    faux.setResponses([fauxAssistantMessage("I'm not attached to a project.")]);
    sendMessage(directChat(helper.id), "tell it yes");
    await idle();
    expect(listMessages(directChat(helper.id)).at(-1)!.suggestions).toBeUndefined();
    expect(listSprockets().find((s) => s.id === lead.id)!.coordinator).toBe(true);
  });

  it("drops suggestions from a run that saved no reply", async () => {
    const { lead, panel } = setup();
    const reply = await suggestThroughRun(lead.id, panel.id, "Yes.", "");
    expect(reply.author).toBe("notice");
    expect(listMessages(projectChat(lead.id)).some((m) => m.suggestions)).toBe(false);
  });
});

describe("messages the user asks for", () => {
  /** The Coordinator, asked in its chat, drafts `message` for the panel with suggest_message. */
  async function messageThroughRun(leadId: string, panelId: string, message: string) {
    const code = `return await tools.suggest_message({ session: ${JSON.stringify(panelId.slice(0, 8))}, message: ${JSON.stringify(message)} })`;
    faux.setResponses([fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }), fauxAssistantMessage("Drafted it below.")]);
    sendMessage(projectChat(leadId), "tell it to stop and summarize");
    await idle();
    return listMessages(projectChat(leadId)).at(-1)!;
  }

  it("drafts a message for a busy session, which goes into its queue when sent", async () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "refactor everything" }); // it's working
    const reply = await messageThroughRun(lead.id, panel.id, "Stop and summarize what you've done.");
    expect(reply.activity).toBe("Drafted a message");
    const [s] = reply.suggestions!;
    expect(s).toMatchObject({ mode: "message", status: "pending" });
    // It doesn't go stale while the session works.
    receive(panel.id, "claude", "PostToolUse", { tool_name: "Edit", tool_input: { file_path: "/work/a.ts" } });
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].status).toBe("pending");
    expect(await sendSuggestion(s.id, s.text)).toMatchObject({ status: "sent", queued: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(received.at(-1)!).message.content).toBe("From your user, sent with Rails:\nStop and summarize what you've done.");
  });

  it("sends a message to an idle session at once, and drops it when the session ends", async () => {
    const { lead, panel } = setup();
    const [s] = (await messageThroughRun(lead.id, panel.id, "Summarize.")).suggestions!;
    expect(await sendSuggestion(s.id, s.text)).toMatchObject({ status: "sent" });
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].queued).toBeUndefined();
    const [t] = (await messageThroughRun(lead.id, panel.id, "And then stop.")).suggestions!;
    receive(panel.id, "claude", "SessionEnd", {});
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0]).toMatchObject({ id: t.id, status: "expired", error: "The session ended." });
  });

  it("says when an idle session shows no sign it took a message, until it reports something", async () => {
    const { lead, panel } = setup();
    const [s] = (await messageThroughRun(lead.id, panel.id, "Summarize.")).suggestions!;
    pickup.ms = 30;
    try {
      expect(await sendSuggestion(s.id, s.text)).toMatchObject({ status: "sent" });
      expect(suggestions.get(s.id)!.unconfirmed).toBeUndefined();
      await new Promise((r) => setTimeout(r, 80));
      expect(suggestions.get(s.id)).toMatchObject({ status: "sent", unconfirmed: true });
      receive(panel.id, "claude", "UserPromptSubmit", { prompt: "Summarize." });
      expect(suggestions.get(s.id)!.unconfirmed).toBeUndefined();
      // One it took at once is never marked.
      const [t] = (await messageThroughRun(lead.id, panel.id, "And then stop.")).suggestions!;
      receive(panel.id, "claude", "Stop", { last_assistant_message: "Done." });
      const sent = sendSuggestion(t.id, t.text);
      await sent;
      receive(panel.id, "claude", "UserPromptSubmit", { prompt: "And then stop." });
      await new Promise((r) => setTimeout(r, 80));
      expect(suggestions.get(t.id)!.unconfirmed).toBeUndefined();
    } finally {
      pickup.ms = 15_000;
    }
  });

  it("drops what waited for a session when its panel moves on to another (Codex's /new)", async () => {
    const { lead, panel } = setup();
    const [t] = (await messageThroughRun(lead.id, panel.id, "Summarize.")).suggestions!;
    record(panel.id, [{ kind: "start", sessionId: "next", from: panel.sessionId }], "next");
    expect(suggestions.get(t.id)).toMatchObject({ status: "expired", error: "The panel moved on to another session." });
  });

  it("points the Coordinator to suggest_message when it tries to answer a session that isn't asking", () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "UserPromptSubmit", { prompt: "go" });
    expect(() => suggest(lead.id, panel, "Fix sidebar", "stop")).toThrow("use suggest_message");
    expect(suggest(lead.id, panel, "Fix sidebar", "stop", { purpose: "message" }).mode).toBe("message");
  });
});

describe("standing rules", () => {
  it("keeps rules trimmed and within limits", () => {
    const s = createSprocket({ name: "Rules", look });
    expect(updateSettings(s.id, { rules: ["  If it asks to continue,   say yes. ", "", " "] }).rules).toEqual(["If it asks to continue, say yes."]);
    expect(() => updateSettings(s.id, { rules: Array.from({ length: 11 }, (_, i) => `Rule ${i}`) })).toThrow("at most 10 rules");
    expect(() => updateSettings(s.id, { rules: ["x".repeat(201)] })).toThrow("at most 200 characters");
    expect(() => updateSettings(s.id, { rules: "say yes" as never })).toThrow("list of sentences");
    expect(listSprockets().find((x) => x.id === s.id)!.rules).toEqual(["If it asks to continue, say yes."]);
  });

  it("gives a Coordinator its rules, numbered, and shows which one a suggestion followed", async () => {
    const { lead, panel } = setup();
    updateSettings(lead.id, { rules: ["Never agree to delete files.", "If it asks whether to update tests, say yes."] });
    let prompt = "";
    let result = "";
    const code = `return await tools.suggest_reply({ session: ${JSON.stringify(panel.id.slice(0, 8))}, reply: "Yes, update them.", rule: 2 })`;
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.filter((m) => (m.role as string) === "system"));
        return fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
      },
      (context) => {
        const last = context.messages.at(-1);
        result = last?.role === "toolResult" ? (last.content[0] as { text: string }).text : "";
        return fauxAssistantMessage("Your rule says yes.");
      },
    ]);
    // Rules change while it runs: the number still means the rule it read.
    sendMessage(projectChat(lead.id), "what should I tell it?");
    updateSettings(lead.id, { rules: ["Always ask me first."] });
    await idle();
    expect(prompt).toContain("<rules>\\n1. Never agree to delete files.\\n2. If it asks whether to update tests, say yes.\\n</rules>");
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions![0].rule).toBe("If it asks whether to update tests, say yes.");
    // Its words come back with the result, for a last look that the rule fits and was followed.
    expect(result).toContain('It cites rule 2: "If it asks whether to update tests, say yes." If that rule doesn\'t fit');
  });

  it("tells the model when the rule it cites doesn't exist", async () => {
    const { lead, panel } = setup();
    let result = "";
    const code = `return await tools.suggest_reply({ session: ${JSON.stringify(panel.id.slice(0, 8))}, reply: "Yes.", rule: 3 })`;
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
      (context) => {
        const last = context.messages.at(-1);
        result = last?.role === "toolResult" ? (last.content[0] as { text: string }).text : "";
        return fauxAssistantMessage("I'll leave the rule out.");
      },
    ]);
    sendMessage(projectChat(lead.id), "what should I tell it?");
    await idle();
    expect(result).toContain("There's no rule 3: you have 0.");
    expect(listMessages(projectChat(lead.id)).at(-1)!.suggestions).toBeUndefined();
  });

  it("leaves rules out of other Sprockets' prompts", async () => {
    const s = createSprocket({ name: "Helper", look });
    updateSettings(s.id, { rules: ["Say yes."] });
    let prompt = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.filter((m) => (m.role as string) === "system"));
        return fauxAssistantMessage("Hi.");
      },
    ]);
    sendMessage(directChat(s.id), "hi");
    await idle();
    expect(prompt).toContain("You are Helper");
    expect(prompt).not.toContain("<rules>");
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
    await expect(sent).resolves.toEqual({ queued: false });
    await expect(box.hand("p1", "again", { takeMs: 150 })).rejects.toThrow("Rails can't reach this pi session");
  });

  it("lets a pi message wait in pi's queue, and says so", async () => {
    const box = new PiInbox();
    const poll = box.poll("p1", new AbortController().signal);
    const sent = box.hand("p1", "stop and summarize", { queue: true });
    const [m] = await poll;
    expect(m.queue).toBe(true);
    box.ack("p1", m.id, true, true);
    await expect(sent).resolves.toEqual({ queued: true });
  });

  it("takes back a message pi put in its editor when its run was stopped", () => {
    const { lead, project } = setup();
    const pi = panels.create({ projectId: project.id, kind: "pi", title: "Notes" });
    receive(pi.id, "pi", "prompt", { text: "go" }); // busy
    const s = suggest(lead.id, pi, "Notes", "Stop and summarize.", { purpose: "message" });
    suggestions.setStatus(s.id, ["pending"], "sent", { queued: true }); // it went into pi's queue
    receive(pi.id, "pi", "returned", { text: "Something else." });
    expect(suggestions.get(s.id)!.status).toBe("sent");
    receive(pi.id, "pi", "returned", { text: "Stop and summarize." }); // Escape: back in pi's editor
    expect(suggestions.get(s.id)).toMatchObject({ status: "expired", error: "pi put it back in its input box when its turn was stopped. Send it from there." });
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

describe("answering pi dialogs (ADR 0027)", () => {
  const select = { id: "select-1", kind: "select" as const, options: ["Yes (Recommended)", "No"], questions: 1 };
  const questionnaire = { id: "rpiv-t1", kind: "questionnaire" as const, options: ["Blue", "Green"], questions: 1 };

  it("matches a drafted answer to the dialog's option, or types it where text is taken", () => {
    expect(dialogAnswer(select, "yes")).toEqual({ id: "select-1", option: 0 });
    expect(dialogAnswer(select, "\u201cNo.\u201d")).toEqual({ id: "select-1", option: 1 });
    expect(dialogAnswer(select, "Yes, but only the tests")).toBeUndefined(); // a select takes only its options
    expect(dialogAnswer(questionnaire, "Green")).toEqual({ id: "rpiv-t1", option: 1 });
    expect(dialogAnswer(questionnaire, "Teal, like the brief")).toEqual({ id: "rpiv-t1", text: "Teal, like the brief" });
    expect(dialogAnswer({ id: "input-2", kind: "input", options: [], questions: 1 }, " main ")).toEqual({ id: "input-2", text: "main" });
    expect(dialogAnswer({ ...questionnaire, questions: 2 }, "Green")).toBeUndefined(); // several questions: in the panel
    expect(dialogAnswer(undefined, "Green")).toBeUndefined();
  });

  /** A draft under a reply in the chat, as a Coordinator's run leaves it. */
  function shownDraft(leadId: string, ...args: Parameters<typeof suggest>) {
    const s = suggest(...args);
    suggestions.attach([s.id], sprocketMessages.create(projectChat(leadId), "sprocket", "Drafted.", new Date().toISOString()).id);
    return s;
  }

  /** A pi session asking in an rpiv questionnaire whose dialog Rails can answer. */
  function asking() {
    const { lead, project } = setup();
    const pi = panels.create({ projectId: project.id, kind: "pi", title: "UI" });
    const input = { questions: [{ question: "Show the key on each shop card?", options: [{ label: "Yes" }, { label: "No" }] }] };
    receive(pi.id, "pi", "tool", { tool: "ask_user_question", input, started: true, id: "t1" });
    receive(pi.id, "pi", "ui_prompt_start", { title: "", kind: "custom", input, dialog: { id: "rpiv-t1", kind: "questionnaire" } });
    return { lead, pi };
  }

  it("sends an answer through the extension, and says why when it's turned down", async () => {
    const { lead, pi } = asking();
    const s = shownDraft(lead.id, lead.id, pi, "UI", "Yes");
    expect(s).toMatchObject({ mode: "answer", dialog: { id: "rpiv-t1", option: 0 } });
    const poll = piInbox.poll(pi.id, new AbortController().signal);
    const sent = sendSuggestion(s.id, undefined);
    const [m] = await poll;
    expect(m.answer).toEqual({ dialog: "rpiv-t1", option: 0 });
    piInbox.ack(pi.id, m.id, false, false, "The question extension didn't take the answer: answer it in the panel.");
    expect(await sent).toMatchObject({ status: "failed", error: "The question extension didn't take the answer: answer it in the panel." });
    // Tried again, and taken.
    const again = piInbox.poll(pi.id, new AbortController().signal);
    const retry = sendSuggestion(s.id, undefined);
    piInbox.ack(pi.id, (await again)[0].id, true);
    expect(await retry).toMatchObject({ status: "sent" });
  });

  it("can't send once the user answered in the panel, and keeps the panel for other dialogs", async () => {
    const { lead, pi } = asking();
    const s = shownDraft(lead.id, lead.id, pi, "UI", "No");
    receive(pi.id, "pi", "ui_prompt_end", {}); // answered in the panel first
    await expect(sendSuggestion(s.id, undefined)).rejects.toThrow();
    expect(suggestions.get(s.id)!.status).toBe("expired");
    // A question dialog Rails can't answer (no dialog id: an older extension, or a custom dialog): the panel.
    const other = panels.create({ projectId: pi.projectId, kind: "pi", title: "Old" });
    const input = { questions: [{ question: "Which colour?", options: ["Blue"] }] };
    receive(other.id, "pi", "ui_prompt_start", { title: "", kind: "custom", input });
    const t = shownDraft(lead.id, lead.id, other, "Old", "Blue");
    expect(t.dialog).toBeUndefined();
    await expect(sendSuggestion(t.id, undefined)).rejects.toThrow("Answer it in the session's panel.");
  });
});

describe("answering Codex's questions (ADR 0027)", () => {
  const ask = (turnId: string) =>
    fromCodex("item/completed", {
      threadId: "t1",
      turnId,
      item: { type: "agentMessage", delivery: "async", text: "Dark or light?", questions: [{ title: "Dark or light theme for the HUD?", options: ["Dark", "Light"] }] },
    });

  it("reads a question Codex asks while its turn goes on", () => {
    expect(ask("turn-1")).toEqual([
      { kind: "waiting", reason: "question", questions: [{ question: "Dark or light theme for the HUD?", options: ["Dark", "Light"] }], dialog: { id: "turn-1", kind: "steer", options: ["Dark", "Light"] } },
    ]);
    // An ordinary final message isn't a question.
    expect(fromCodex("item/completed", { item: { type: "agentMessage", text: "Done.", questions: null } })).toEqual([]);
  });

  it("keeps the answer while Codex works on, and drafts it as the option's label or the text", () => {
    const { lead, project } = setup();
    const codex = panels.create({ projectId: project.id, kind: "codex", title: "Gameplay", sessionId: `t-${Math.random()}` });
    record(codex.id, ask("turn-1"));
    const s = suggest(lead.id, codex, "Gameplay", "dark");
    expect(s).toMatchObject({ mode: "answer", dialog: { id: "turn-1", text: "Dark" } });
    record(codex.id, [{ kind: "tool", tool: "shell", files: [], edit: false, command: "sleep 60" }]); // it waits by working
    expect(suggestions.get(s.id)!.status).toBe("pending");
    const t = suggest(lead.id, codex, "Gameplay", "Dark, with brass accents");
    expect(t.dialog).toEqual({ id: "turn-1", text: "Dark, with brass accents" });
    record(codex.id, [{ kind: "prompt", text: "Light" }]); // answered in the panel
    expect(suggestions.get(t.id)!.status).toBe("expired");
  });

  it("steers the question's turn, or sends the answer as the next message once the turn is over", async () => {
    const sent: any[] = [];
    const watcher = new CodexWatcher((m) => sent.push(m), () => {});
    const steered = watcher.steer("t1", "turn-1", "Dark");
    expect(sent.at(-1)).toMatchObject({ method: "turn/steer", params: { threadId: "t1", expectedTurnId: "turn-1", input: [{ type: "text", text: "Dark" }] } });
    watcher.handle({ id: sent.at(-1).id, result: { turnId: "turn-1" } });
    await expect(steered).resolves.toBeUndefined();
    const late = watcher.steer("t1", "turn-1", "Dark");
    watcher.handle({ id: sent.at(-1).id, error: { message: "expected turn mismatch" } });
    await expect(late).rejects.toThrow("Codex refused the answer: expected turn mismatch");
    void watcher.steer("t1", undefined, "Dark");
    expect(sent.at(-1).method).toBe("thread/queue/add");
  });
});

describe("answering Claude Code's questions (ADR 0028)", () => {
  it("sends the answer to Rails' mod, which closes the dialog, and says why when it couldn't", async () => {
    const { lead, panel } = setup();
    receive(panel.id, "claude", "dialog", { id: "toolu_1", question: "Dark or light?", options: ["Dark", "Light"] });
    receive(panel.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Dark or light?", options: [{ label: "Dark" }, { label: "Light" }] }] } });
    const s = suggest(lead.id, panel, "Fix sidebar", "light");
    expect(s).toMatchObject({ mode: "answer", dialog: { id: "toolu_1", text: "Light" } });
    suggestions.attach([s.id], sprocketMessages.create(projectChat(lead.id), "sprocket", "Drafted.", new Date().toISOString()).id);
    const poll = claudeInbox.poll(panel.id, new AbortController().signal);
    const sent = sendSuggestion(s.id, undefined);
    const [m] = await poll;
    expect(m.answer).toEqual({ dialog: "toolu_1", text: "Light" });
    claudeInbox.ack(panel.id, m.id, false, false, "The dialog has closed.");
    expect(await sent).toMatchObject({ status: "failed", error: "The dialog has closed." });
    // Without the mod (an older Claude Code): no dialog id, so the panel.
    const { lead: l2, panel: p2 } = setup();
    receive(p2.id, "claude", "PreToolUse", { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Dark or light?", options: [] }] } });
    expect(suggest(l2.id, p2, "Fix sidebar", "Dark").dialog).toBeUndefined();
  });
});
