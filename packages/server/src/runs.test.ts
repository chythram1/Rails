import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { SPROCKET_DESCRIPTION_MAX } from "@rails/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projects, settings, sprockets } from "./db.ts";
import { models, refOf } from "./models.ts";
import { CORE_MEMORY_MAX, editMemory } from "./harness/memory.ts";
import { idle, isRunning, onActivity, onTyping, readableError, REQUEST_TIMEOUT_MS, RETRY_MS } from "./runs.ts";
import { sprocketMessages } from "./db.ts";
import { createSprocket, deleteSprocket, detachFromProject, directChat, listMessages, listSprockets, projectChat, sendMessage, updateSettings } from "./sprockets.ts";

// A scripted model stands in for a real provider.
const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "bean", color: "teal", accessory: "none" } as const;

const authors = (id: string) => listMessages(directChat(id)).map((m) => `${m.author}: ${m.text}`);
const sprocket = () => createSprocket({ name: "Helper", look });

beforeEach(() => settings.set("defaultModel", ref));

describe("runs", () => {
  it("replies to a message with the default model", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("Hi! How can I help?")]);
    sendMessage(directChat(s.id), "hello");
    await idle();
    expect(authors(s.id)).toEqual(["user: hello", "sprocket: Hi! How can I help?"]);
    expect(listSprockets().find((x) => x.id === s.id)!.running).toBe(false);
  });

  it("adds up what its runs use", async () => {
    const s = sprocket();
    expect(listSprockets().find((x) => x.id === s.id)!.usage).toEqual({ runs: 0, tokens: 0, cost: 0 });
    faux.setResponses([fauxAssistantMessage("One."), fauxAssistantMessage("Two.")]);
    sendMessage(directChat(s.id), "hello");
    await idle();
    sendMessage(directChat(s.id), "again");
    await idle();
    const { runs, tokens, cost } = listSprockets().find((x) => x.id === s.id)!.usage;
    expect([runs, cost]).toEqual([2, 0]);
    expect(tokens).toBeGreaterThan(0);
  });

  it("streams the reply while it's written", async () => {
    const s = sprocket();
    const seen: (string | null)[] = [];
    onTyping((id, _chat, text) => id === s.id && seen.push(text));
    faux.setResponses([fauxAssistantMessage("A longer reply that streams in several pieces.")]);
    sendMessage(directChat(s.id), "hi");
    await idle();
    expect(seen.at(-1)).toBeNull(); // typing ends with null
  });

  it("explains instead of replying when there's no model", async () => {
    settings.set("defaultModel", null);
    const s = sprocket();
    sendMessage(directChat(s.id), "hello");
    await idle();
    expect(authors(s.id)).toEqual(["user: hello", "notice: Pick a model first: connect a provider in Settings → Providers."]);
  });

  it("edits its core memory with the remember tool, from a codemode script", async () => {
    const s = sprocket();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: 'return await tools.remember({ op: "add", text: "Prefers short answers." })' })], { stopReason: "toolUse" }),
      fauxAssistantMessage("Got it."),
    ]);
    const steps: (string | null)[] = [];
    onActivity((sprocketId, _chat, step) => sprocketId === s.id && steps.push(step));
    sendMessage(directChat(s.id), "keep it short from now on");
    await idle();
    expect(sprockets.get(s.id)!.coreMemory).toBe("Prefers short answers.");
    expect(authors(s.id).at(-1)).toBe("sprocket: Got it.");
    // The run log: the step while it ran, then what the reply did, saved with it.
    expect(steps).toEqual(["Updating its memory", null, null]);
    expect(listMessages(directChat(s.id)).at(-1)!.activity).toBe("Updated its memory");
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
    sendMessage(directChat(s.id), "what's going on?");
    await idle();
    sendMessage(directChat(s.id), "did you check?");
    await idle();
    // The faux model gets the system prompt as a message of its own.
    // The last one is Rails' reminder of how to write (not saved).
    expect(seen).toEqual(["system", "user", "assistant", "toolResult: the board says: all idle", "assistant", "user", "user"]);
  });

  it("doesn't let a run put back the store of a project the Sprocket left while it ran", async () => {
    const s = sprocket();
    const p = projects.create("app", "/work/store-" + s.id);
    updateSettings(s.id, { projectId: p.id });
    faux.setResponses([
      () => {
        detachFromProject(p.id); // the project is removed from Rails while the run goes on (moving it is refused then)
        return fauxAssistantMessage([fauxToolCall("codemode", { code: 'store("seen", ["a.ts"])' })], { stopReason: "toolUse" });
      },
      fauxAssistantMessage("Done."),
    ]);
    sendMessage(directChat(s.id), "look around");
    await idle();
    expect(sprockets.codemodeStore(s.id)).toEqual({});
  });

  it("stops a run that keeps calling tools", async () => {
    const s = sprocket();
    const loop = fauxAssistantMessage([fauxToolCall("codemode", { code: 'text("still looking")' })], { stopReason: "toolUse" });
    faux.setResponses(Array.from({ length: 20 }, () => loop));
    sendMessage(directChat(s.id), "go");
    await idle();
    expect(authors(s.id).at(-1)).toBe("notice: Stopped after 12 steps.");
  });

  it("reports model errors as a notice", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage: "Incorrect API key provided." })]);
    sendMessage(directChat(s.id), "hello");
    await idle();
    expect(authors(s.id).at(-1)).toBe("notice: The model returned an error: Incorrect API key provided.");
  });

  describe("when the provider fails", () => {
    /** The provider fails, and the clock goes fake from here, so the wait before a retry can be skipped. */
    const failure = (errorMessage: string) => () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      return fauxAssistantMessage([fauxText("")], { stopReason: "error", errorMessage });
    };
    afterEach(() => vi.useRealTimers());
    // Run 3's failures, as pi-ai reports them.
    const DROPPED = "Connection error.";
    const BUSY = 'OpenAI API error (503): {"error":{"message":"The ChatGPT user is temporarily unavailable. Please try again later."}}';
    const HUNG = "Request timed out.";
    const LIMIT = 'OpenAI API error (429): {"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"The ChatGPT user has reached their Subscription Sharing usage limit."}}';

    /** Send a message and let the run finish, skipping the wait before a retry. */
    async function reply(id: string, text: string) {
      sendMessage(directChat(id), text);
      while (isRunning(id)) {
        if (vi.isFakeTimers() && vi.getTimerCount()) await vi.advanceTimersByTimeAsync(RETRY_MS);
        await new Promise((r) => setImmediate(r));
      }
      vi.useRealTimers();
      await idle();
    }

    it("tries once more after a dropped connection or a busy provider, and replies", async () => {
      for (const error of [DROPPED, BUSY]) {
        const s = sprocket();
        const steps: (string | null)[] = [];
        onActivity((id, _chat, step) => id === s.id && steps.push(step));
        faux.setResponses([failure(error), fauxAssistantMessage("Here it is.")]);
        await reply(s.id, "hello");
        expect(authors(s.id)).toEqual(["user: hello", "sprocket: Here it is."]); // no notice
        expect(steps).toContain("Trying the model again");
      }
    });

    it("gives up on a request the provider doesn't answer, then tries once more", async () => {
      const s = sprocket();
      let timeout: number | undefined;
      faux.setResponses([
        (_context, options) => {
          timeout = options?.timeoutMs;
          return failure(HUNG)();
        },
        fauxAssistantMessage("Here it is."),
      ]);
      await reply(s.id, "hello");
      expect(timeout).toBe(REQUEST_TIMEOUT_MS);
      expect(REQUEST_TIMEOUT_MS).toBeLessThan(5 * 60_000); // what a hung request waited in run 3
      expect(authors(s.id)).toEqual(["user: hello", "sprocket: Here it is."]);
    });

    it("tries only once, then reports the error", async () => {
      const s = sprocket();
      faux.setResponses([failure(DROPPED), failure(DROPPED), fauxAssistantMessage("never")]);
      await reply(s.id, "hello");
      expect(authors(s.id)).toEqual(["user: hello", "notice: The model returned an error: Connection error."]);
      expect(faux.getPendingResponseCount()).toBe(1);
      faux.setResponses([]);
    });

    it("doesn't retry a usage limit, which won't pass in seconds", async () => {
      const s = sprocket();
      faux.setResponses([failure(LIMIT), fauxAssistantMessage("never")]);
      await reply(s.id, "hello");
      expect(authors(s.id).at(-1)).toBe("notice: The model returned an error: 429 The ChatGPT user has reached their Subscription Sharing usage limit.");
      expect(faux.getPendingResponseCount()).toBe(1);
      faux.setResponses([]);
    });

    it("goes on from where the run was, so work it did isn't done again", async () => {
      const s = sprocket();
      let ran = 0;
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("codemode", { code: "text('looked')" })], { stopReason: "toolUse" }),
        failure(DROPPED),
        (context) => {
          ran = context.messages.filter((m) => m.role === "toolResult").length;
          return fauxAssistantMessage("Done.");
        },
      ]);
      await reply(s.id, "look");
      expect(authors(s.id).at(-1)).toBe("sprocket: Done.");
      expect(ran).toBe(1); // the script's result is still there, once, and no failed reply in between
      expect(sprocketMessages.recentSteps(directChat(s.id), s.id, 1).values().next().value?.filter((m: any) => m.role === "assistant" && m.stopReason === "error")).toEqual([]);
    });

    it("doesn't try again for a Sprocket deleted meanwhile", async () => {
      const s = sprocket();
      faux.setResponses([
        () => {
          deleteSprocket(s.id);
          return failure(DROPPED)();
        },
        fauxAssistantMessage("never"),
      ]);
      await reply(s.id, "hello");
      expect(faux.getPendingResponseCount()).toBe(1);
      faux.setResponses([]);
    });
  });

  it("drops the reply of a Sprocket deleted while it was replying", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("too late")]);
    const chat = directChat(s.id);
    sendMessage(chat, "hello");
    deleteSprocket(s.id);
    await idle();
    expect(sprocketMessages.list(chat)).toEqual([]);
  });

  it("answers messages that arrive while it's replying", async () => {
    const s = sprocket();
    faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
    sendMessage(directChat(s.id), "one");
    sendMessage(directChat(s.id), "two");
    await idle();
    expect(authors(s.id)).toEqual(["user: one", "sprocket: first", "user: two", "sprocket: second"]);
  });
});

describe("settings", () => {
  it("moving to another project keeps the direct chat, the description and core memory (ADR 0021)", async () => {
    const s = sprocket();
    const p = projects.create("app", "/work/app-" + s.id);
    updateSettings(s.id, { description: "Watch the PRs." });
    sprockets.setCoreMemory(s.id, "Likes tea.");
    sendMessage(directChat(s.id), "hello");
    faux.setResponses([fauxAssistantMessage("hi")]);
    await idle();
    const moved = updateSettings(s.id, { projectId: p.id });
    expect(moved.projectId).toBe(p.id);
    expect(moved.description).toBe("Watch the PRs.");
    expect(sprockets.get(s.id)!.coreMemory).toBe("Likes tea.");
    expect("coreMemory" in moved).toBe(false); // internal: never sent to browsers
    expect(authors(s.id)).toEqual(["user: hello", "sprocket: hi"]);
    expect(listMessages(projectChat(s.id))).toEqual([]); // and a new, empty project chat
  });

  it("changes nothing when any field is invalid", async () => {
    const s = sprocket();
    const p = projects.create("other", "/work/other-" + s.id);
    sendMessage(directChat(s.id), "keep me");
    faux.setResponses([fauxAssistantMessage("ok")]);
    await idle();
    expect(() => updateSettings(s.id, { projectId: p.id, model: "nope/nope" })).toThrow("Unknown model");
    expect(() => updateSettings(s.id, { projectId: p.id, description: "x".repeat(SPROCKET_DESCRIPTION_MAX + 1) })).toThrow("at most");
    expect(listSprockets().find((x) => x.id === s.id)!.projectId).toBeUndefined();
    expect(listMessages(directChat(s.id)).map((m) => m.text)).toEqual(["keep me", "ok"]);
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
