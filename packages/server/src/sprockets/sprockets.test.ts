import { describe, expect, it, vi } from "vitest";
import { idle } from "./runs.ts";
import { sprocketMessages, sprockets } from "../db.ts";
import { createSprocket, deleteSprocket, directChat, listMessages, listSprockets, onSprocketsChanged, readChat, sendMessage, updateSprocket } from "./sprockets.ts";

const look = { character: "roo", color: "blue" } as const;

describe("sprockets", () => {
  it("creates a Sprocket with a trimmed name and tells listeners", () => {
    const fn = vi.fn();
    onSprocketsChanged(fn);
    const s = createSprocket({ name: "  PR Pal  ", look });
    expect(s.name).toBe("PR Pal");
    expect(s.look).toEqual(look);
    expect(fn).toHaveBeenCalled();
    expect(listSprockets().some((x) => x.id === s.id)).toBe(true);
  });

  it("refuses empty or long names and unknown look ids", () => {
    expect(() => createSprocket({ name: " ", look })).toThrow("Give it a name.");
    expect(() => createSprocket({ name: "x".repeat(41), look })).toThrow("at most 40");
    expect(() => createSprocket({ name: "A", look: { ...look, character: "dragon" as never } })).toThrow("Unknown character");
    expect(() => createSprocket({ name: "A", look: { ...look, color: "plaid" as never } })).toThrow("Unknown colour");
  });

  it("drops an accessory from a look, as a client from before they went sends it", () => {
    const s = createSprocket({ name: "Hatted", look: { ...look, accessory: "cap" } as never });
    expect(s.look).toEqual(look);
  });

  it("repairs stored looks whose ids no longer exist", () => {
    const row = sprockets.create("Old", { character: "gone", color: "gone", accessory: "gone" } as never);
    const s = listSprockets().find((x) => x.id === row.id)!;
    expect(s.look).toEqual({ character: "block", color: "yellow" });
  });

  it("loads Bean and Lune, which were replaced, as Blob and Drop", () => {
    const bean = sprockets.create("Bean", { character: "bean", color: "green" } as never);
    const lune = sprockets.create("Lune", { character: "lune", color: "blue" } as never);
    const list = listSprockets();
    expect(list.find((x) => x.id === bean.id)!.look).toEqual({ character: "blob", color: "green" });
    expect(list.find((x) => x.id === lune.id)!.look).toEqual({ character: "drop", color: "blue" });
  });

  it("updates, stores messages in order and deletes them with the Sprocket", async () => {
    const s = createSprocket({ name: "Helper", look });
    expect(updateSprocket(s.id, { name: "Helper 2", look: { ...look, color: "green" } }).look.color).toBe("green");
    const chat = directChat(s.id);
    sendMessage(chat, " first ");
    sendMessage(chat, "second");
    // With no model set up, each message also gets a notice saying so (see runs.test.ts).
    expect(listMessages(chat).filter((m) => m.author === "user").map((m) => m.text)).toEqual(["first", "second"]);
    await idle();
    deleteSprocket(s.id);
    expect(() => listMessages(chat)).toThrow("Not found");
  });

  it("marks a chat unread when a Sprocket writes after you last saw it, on every device", async () => {
    const s = createSprocket({ name: "Teller", look });
    const chat = directChat(s.id);
    const unread = () => listSprockets().find((x) => x.id === s.id)!.direct.unread;
    const later = (ms: number) => new Date(Date.now() + ms).toISOString();
    expect(unread()).toBe(false);
    sprocketMessages.create(chat, "notice", "Pick a model first.", later(5)); // Rails' own notice: not the Sprocket
    sprocketMessages.create(chat, "user", "hi", later(6));
    expect(unread()).toBe(false);
    sprocketMessages.create(chat, "sprocket", "Hello!", later(7));
    expect(unread()).toBe(true);
    vi.useFakeTimers({ now: Date.now() + 8, toFake: ["Date"] });
    sendMessage(chat, "thanks"); // writing in it, you've seen it
    vi.useRealTimers();
    expect(unread()).toBe(false);
    sprocketMessages.create(chat, "sprocket", "Anytime.", later(9));
    expect(unread()).toBe(true);
    const seen = vi.fn();
    const off = onSprocketsChanged(seen);
    vi.useFakeTimers({ now: Date.now() + 10, toFake: ["Date"] });
    readChat(chat);
    vi.useRealTimers();
    off();
    expect(unread()).toBe(false);
    expect(seen).toHaveBeenCalled(); // other devices' dots go too
    await idle(); // the reply "thanks" asked for (with no model, a notice)
  });

  it("refuses empty and oversized messages", () => {
    const s = createSprocket({ name: "Quiet", look });
    expect(() => sendMessage(directChat(s.id), "   ")).toThrow("Message is empty");
    expect(() => sendMessage(directChat(s.id), "x".repeat(4001))).toThrow("at most 4000");
    expect(() => sendMessage(directChat(s.id), 42)).toThrow("Message is empty");
  });
});
