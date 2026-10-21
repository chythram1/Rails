import { describe, expect, it } from "vitest";
import { promptsCapability } from "./harness/prompts.ts";
import { createSavedPrompt, deleteSavedPrompt, listSavedPrompts, updateSavedPrompt } from "./savedPrompts.ts";

describe("saved prompts", () => {
  it("creates, edits, checks and deletes prompts", () => {
    const p = createSavedPrompt({ name: "Review", text: "Review the diff." });
    expect(updateSavedPrompt(p.id, { text: "  Review the staged diff.  " })).toMatchObject({ name: "Review", text: "Review the staged diff." });
    expect(createSavedPrompt().name).toBe("New prompt");
    expect(() => updateSavedPrompt(p.id, { name: " " })).toThrow("name");
    expect(() => createSavedPrompt({ name: "Long", text: "x".repeat(4001) })).toThrow("at most");
    deleteSavedPrompt(p.id);
    expect(listSavedPrompts().some((x) => x.id === p.id)).toBe(false);
    expect(() => deleteSavedPrompt(p.id)).toThrow("not found");
  });

  it("gives any Sprocket the user's saved prompts by name, read-only", async () => {
    createSavedPrompt({ name: "Standup", text: "Summarize what changed since yesterday." });
    const out = (await promptsCapability.run({}, { sprocketId: "s", signal: new AbortController().signal })) as { name: string; text: string }[];
    expect(out).toContainEqual({ name: "Standup", text: "Summarize what changed since yesterday." });
    expect(promptsCapability.effect).toBe("read");
  });
});
