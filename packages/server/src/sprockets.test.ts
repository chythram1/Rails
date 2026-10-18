import { describe, expect, it, vi } from "vitest";
import { idle } from "./runs.ts";
import { sprockets } from "./db.ts";
import { createSprocket, deleteSprocket, listMessages, listSprockets, onSprocketsChanged, sendMessage, updateSprocket } from "./sprockets.ts";

const look = { character: "roo", color: "blue", accessory: "cap" } as const;

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
    expect(() => createSprocket({ name: "A", look: { ...look, accessory: "monocle" as never } })).toThrow("Unknown accessory");
  });

  it("defaults a missing accessory to none", () => {
    const s = createSprocket({ name: "Bare", look: { character: "bean", color: "red" } as never });
    expect(s.look.accessory).toBe("none");
  });

  it("repairs stored looks whose ids no longer exist", () => {
    const row = sprockets.create("Old", { character: "gone", color: "gone", accessory: "gone" } as never);
    const s = listSprockets().find((x) => x.id === row.id)!;
    expect(s.look).toEqual({ character: "block", color: "yellow", accessory: "none" });
  });

  it("updates, stores messages in order and deletes them with the Sprocket", async () => {
    const s = createSprocket({ name: "Helper", look });
    expect(updateSprocket(s.id, { name: "Helper 2", look: { ...look, color: "green" } }).look.color).toBe("green");
    sendMessage(s.id, " first ");
    sendMessage(s.id, "second");
    // With no model set up, each message also gets a notice saying so (see runs.test.ts).
    expect(listMessages(s.id).filter((m) => m.author === "user").map((m) => m.text)).toEqual(["first", "second"]);
    await idle();
    deleteSprocket(s.id);
    expect(() => listMessages(s.id)).toThrow("Not found");
  });

  it("refuses empty and oversized messages", () => {
    const s = createSprocket({ name: "Quiet", look });
    expect(() => sendMessage(s.id, "   ")).toThrow("Message is empty");
    expect(() => sendMessage(s.id, "x".repeat(4001))).toThrow("at most 4000");
    expect(() => sendMessage(s.id, 42)).toThrow("Message is empty");
  });
});
