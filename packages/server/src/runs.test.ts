import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { SPROCKET_DESCRIPTION_MAX } from "@rails/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { projects, settings, sprockets } from "./db.ts";
import { models, refOf } from "./models.ts";
import { CORE_MEMORY_MAX, editMemory } from "./harness/memory.ts";
import { idle, onActivity, onTyping, readableError } from "./runs.ts";
import { sprocketMessages } from "./db.ts";
import { createSprocket, deleteSprocket, listMessages, listSprockets, sendMessage, updateSettings } from "./sprockets.ts";

// A scripted model stands in for a real provider.
const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "bean", color: "teal", accessory: "none" } as const;

const authors = (id: string) => listMessages(id).map((m) => `${m.author}: ${m.text}`);
const sprocket = () => createSprocket({ name: "Helper", look });

beforeEach(() => settings.set("defaultModel", ref));

describe("runs", () => {
  it("replies to a message with the default model", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("Hi! How can I help?")]);
    sendMessage(s.id, "hello");
    await idle();
    expect(authors(s.id)).toEqual(["user: hello", "sprocket: Hi! How can I help?"]);
    expect(listSprockets().find((x) => x.id === s.id)!.running).toBe(false);
  });

  it("streams the reply while it's written", async () => {
    const s = sprocket();
    const seen: (string | null)[] = [];
    onTyping((id, text) => id === s.id && seen.push(text));
    faux.setResponses([fauxAssistantMessage("A longer reply that streams in several pieces.")]);
    sendMessage(s.id, "hi");
    await idle();
    expect(seen.at(-1)).toBeNull(); // typing ends with null
  });

  it("explains instead of replying when there's no model", async () => {
    settings.set("defaultModel", null);
    const s = sprocket();
    sendMessage(s.id, "hello");
    await idle();
    expect(authors(s.id)).toEqual(["user: hello", "notice: Pick a model first: set up a provider in Settings → Models."]);
  });

  it("edits its core memory with the remember tool, from a codemode script", async () => {
    const s = sprocket();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: 'return await tools.remember({ op: "add", text: "Prefers short answers." })' })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Got it."),
    ]);
    const steps: (string | null)[] = [];
    onActivity((sprocketId, step) => sprocketId === s.id && steps.push(step));
    sendMessage(s.id, "keep it short from now on");
    await idle();
    expect(sprockets.get(s.id)!.coreMemory).toBe("Prefers short answers.");
    expect(authors(s.id).at(-1)).toBe("sprocket: Got it.");
    // The run log: the step while it ran, then what the reply did, saved with it.
    expect(steps).toEqual(["Updating its memory", null, null]);
    expect(listMessages(s.id).at(-1)!.activity).toBe("Updated its memory");
  });

  it("shows the model the tool work behind its recent replies, so it knows what it looked at", async () => {
    const s = sprocket();
    let seen: string[] = [];
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: 'text("the board says: all idle")' })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Everything is idle."),
      (context) => {
        seen = context.messages.map((m) => (m.role === "toolResult" ? `toolResult: ${(m.content[0] as { text: string }).text.split("\n").at(-1)}` : m.role));
        return fauxAssistantMessage("Yes, I checked the board.");
      },
    ]);
    sendMessage(s.id, "what's going on?");
    await idle();
    sendMessage(s.id, "did you check?");
    await idle();
    // The faux model gets the system prompt as a message of its own.
    expect(seen).toEqual(["system", "user", "assistant", "toolResult: the board says: all idle", "assistant", "user"]);
  });

  it("stops a run that keeps calling tools", async () => {
    const s = sprocket();
    const loop = fauxAssistantMessage([fauxToolCall("codemode", { code: 'text("still looking")' })], { stopReason: "toolUse" });
    faux.setResponses(Array.from({ length: 20 }, () => loop));
    sendMessage(s.id, "go");
    await idle();
    expect(authors(s.id).at(-1)).toBe("notice: Stopped after 12 steps.");
  });

  it("reports model errors as a notice", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "rate limited" })]);
    sendMessage(s.id, "hello");
    await idle();
    expect(authors(s.id).at(-1)).toBe("notice: The model returned an error: rate limited");
  });

  it("drops the reply of a Sprocket deleted while it was replying", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("too late")]);
    sendMessage(s.id, "hello");
    deleteSprocket(s.id);
    await idle();
    expect(sprocketMessages.list(s.id)).toEqual([]);
  });

  it("answers messages that arrive while it's replying", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    sendMessage(s.id, "one");
    sendMessage(s.id, "two");
    await idle();
    expect(authors(s.id)).toEqual(["user: one", "sprocket: first", "user: two", "sprocket: second"]);
  });
});

describe("settings", () => {
  it("moving to another project deletes the chat but keeps the description and core memory", async () => {
    const s = sprocket();
    const p = projects.create("app", "/work/app-" + s.id);
    updateSettings(s.id, { description: "Watch the PRs." });
    sprockets.setCoreMemory(s.id, "Likes tea.");
    sendMessage(s.id, "hello");
    faux.setResponses([fauxAssistantMessage("hi")]);
    await idle();
    const moved = updateSettings(s.id, { projectId: p.id });
    expect(moved.projectId).toBe(p.id);
    expect(moved.description).toBe("Watch the PRs.");
    expect(sprockets.get(s.id)!.coreMemory).toBe("Likes tea.");
    expect("coreMemory" in moved).toBe(false); // internal: never sent to browsers
    expect(listMessages(s.id)).toEqual([]);
  });

  it("changes nothing when any field is invalid", async () => {
    const s = sprocket();
    const p = projects.create("other", "/work/other-" + s.id);
    sendMessage(s.id, "keep me");
    faux.setResponses([fauxAssistantMessage("ok")]);
    await idle();
    expect(() => updateSettings(s.id, { projectId: p.id, model: "nope/nope" })).toThrow("Unknown model");
    expect(() => updateSettings(s.id, { projectId: p.id, description: "x".repeat(SPROCKET_DESCRIPTION_MAX + 1) })).toThrow("at most");
    expect(listSprockets().find((x) => x.id === s.id)!.projectId).toBeUndefined();
    expect(listMessages(s.id).map((m) => m.text)).toEqual(["keep me", "ok"]);
  });

  it("validates project, model and description", () => {
    const s = sprocket();
    expect(() => updateSettings(s.id, { projectId: "nope" })).toThrow("Unknown project");
    expect(() => updateSettings(s.id, { model: "nope/nope" })).toThrow("Unknown model");
    expect(() => updateSettings(s.id, { description: "x".repeat(SPROCKET_DESCRIPTION_MAX + 1) })).toThrow(`at most ${SPROCKET_DESCRIPTION_MAX}`);
    expect(updateSettings(s.id, { model: ref }).model).toBe(ref);
    expect(updateSettings(s.id, { model: null }).model).toBeUndefined();
  });
});

describe("editMemory", () => {
  it("adds lines, replaces exact text and rewrites", () => {
    expect(editMemory("", { op: "add", text: "a" })).toBe("a");
    expect(editMemory("a", { op: "add", text: "b" })).toBe("a\nb");
    expect(editMemory("a\nb", { op: "replace", old: "a", text: "c" })).toBe("c\nb");
    expect(editMemory("a\nb\nc", { op: "replace", old: "b", text: "" })).toBe("a\nc");
    expect(editMemory("a", { op: "rewrite", text: "z" })).toBe("z");
  });

  it("refuses to go over the limit or replace missing text", () => {
    expect(() => editMemory("", { op: "add", text: "x".repeat(CORE_MEMORY_MAX + 1) })).toThrow("the limit is");
    expect(() => editMemory("a", { op: "replace", old: "zzz", text: "b" })).toThrow("must be text");
  });
});

describe("readableError", () => {
  it("pulls the message out of a provider's JSON error", () => {
    expect(readableError('401 {"type":"error","error":{"type":"authentication_error","message":"Missing Authentication header"}}')).toBe(
      "401 Missing Authentication header",
    );
    expect(readableError('OpenAI API error (400): 400 {"detail":"The \'gpt-x\' model is not supported."}')).toBe("400 The 'gpt-x' model is not supported.");
    expect(readableError("socket hang up")).toBe("socket hang up");
    expect(readableError(undefined)).toBe("unknown error");
  });
});
