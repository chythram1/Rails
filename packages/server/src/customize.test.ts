import { describe, expect, it } from "vitest";
import { createPrompt, updatePrompt } from "./customize.ts";
import { promptsCapability } from "./harness/prompts.ts";

describe("saved prompts", () => {
  it("creates, edits and checks prompts", () => {
    const p = createPrompt({ name: "Review", text: "Review the diff." });
    expect(updatePrompt(p.id, { text: "  Review the staged diff.  " })).toMatchObject({ name: "Review", text: "Review the staged diff." });
    expect(() => updatePrompt(p.id, { name: " " })).toThrow("name");
    expect(() => createPrompt({ name: "Long", text: "x".repeat(4001) })).toThrow("at most");
  });
});

describe("saved_prompts capability", () => {
  it("gives any Sprocket the user's saved prompts by name", async () => {
    createPrompt({ name: "Standup", text: "Summarize what changed since yesterday." });
    const out = (await promptsCapability.run({}, { sprocketId: "s", signal: new AbortController().signal })) as { name: string; text: string }[];
    expect(out).toContainEqual({ name: "Standup", text: "Summarize what changed since yesterday." });
    expect(promptsCapability.effect).toBe("read");
  });
});
