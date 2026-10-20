import { describe, expect, it, vi } from "vitest";

// Which panels count as running: tmux is faked (panels.test.ts does the same).
const running = new Set<string>();
vi.mock("./tmux.ts", () => ({ runningPanels: vi.fn(async () => new Set(running)) }));
import { createPrompt, createProfile, deleteProfile, launchProfile, listProfiles, profileUses, updatePrompt, updateProfile } from "./customize.ts";
import { panels, projects } from "./db.ts";
import { profileFlags } from "./panels.ts";
import { promptsCapability } from "./harness/prompts.ts";

describe("agent profiles", () => {
  it("creates a Claude Code profile with free names and the agent's defaults", () => {
    const a = createProfile({ agent: "claude" });
    const b = createProfile({ agent: "claude" });
    expect([a.name, b.name]).toEqual(["New profile", "New profile 2"]);
    expect(a).toMatchObject({ model: "", effort: "", permissionMode: "", instructions: "", allowedTools: [], disallowedTools: [], isDefault: false });
  });

  it("refuses agents without profiles, unknown values and flag-like input", () => {
    expect(() => createProfile({ agent: "codex" })).toThrow("Claude Code");
    const p = createProfile({ agent: "claude", name: "Strict" });
    expect(() => updateProfile(p.id, { permissionMode: "yolo" as any })).toThrow("permission mode");
    expect(() => updateProfile(p.id, { effort: "huge" as any })).toThrow("effort");
    expect(() => updateProfile(p.id, { model: "--dangerously-skip-permissions" })).toThrow("model name");
    expect(() => updateProfile(p.id, { allowedTools: ["--resume"] })).toThrow("isn't a tool name");
    expect(() => updateProfile(p.id, { instructions: "x".repeat(2001) })).toThrow("at most");
    expect(() => updateProfile(p.id, { name: "strict" })).not.toThrow(); // its own name, other case
    expect(() => createProfile({ agent: "claude", name: "STRICT" })).toThrow("already");
    expect(() => updateProfile(p.id, { agent: "pi" })).toThrow("can't change");
  });

  it("changes only what a request has, after checking all of it", () => {
    const p = createProfile({ agent: "claude", name: "Partial", model: "opus" });
    expect(() => updateProfile(p.id, { effort: "high", permissionMode: "nope" as any })).toThrow();
    expect(listProfiles().find((x) => x.id === p.id)).toMatchObject({ model: "opus", effort: "" });
    const next = updateProfile(p.id, { allowedTools: [" Edit ", "", "Bash(git *)"] });
    expect(next).toMatchObject({ model: "opus", allowedTools: ["Edit", "Bash(git *)"] });
  });

  it("keeps one default per agent and uses it when no profile is picked", () => {
    const a = createProfile({ agent: "claude", name: "Default A", isDefault: true });
    const b = createProfile({ agent: "claude", name: "Default B" });
    expect(launchProfile("claude", undefined)?.id).toBe(a.id);
    updateProfile(b.id, { isDefault: true });
    expect(listProfiles().filter((p) => p.isDefault).map((p) => p.id)).toEqual([b.id]);
    expect(launchProfile("claude", undefined)?.id).toBe(b.id);
    expect(launchProfile("claude", a.id)?.id).toBe(a.id);
    expect(() => launchProfile("pi", a.id)).toThrow("Unknown profile");
    expect(() => launchProfile("shell", a.id)).toThrow("Shells");
    deleteProfile(b.id);
    expect(launchProfile("claude", undefined)).toBeUndefined();
  });

  it("turns a profile into Claude Code flags, one value per argv entry", () => {
    const p = createProfile({
      agent: "claude",
      name: "Flags",
      model: "sonnet",
      effort: "high",
      permissionMode: "plan",
      instructions: "Use pnpm.\nNever push.",
      allowedTools: ["Bash(git *)", "Edit"],
      disallowedTools: ["WebFetch"],
    });
    expect(profileFlags("claude", p)).toEqual([
      "--model", "sonnet",
      "--effort", "high",
      "--permission-mode", "plan",
      "--append-system-prompt", "Use pnpm.\nNever push.",
      "--allowed-tools", "Bash(git *)", "Edit",
      "--disallowed-tools", "WebFetch",
    ]);
    expect(profileFlags("codex", p)).toEqual([]);
    expect(profileFlags("claude", undefined)).toEqual([]);
  });
});

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

describe("where a profile is in use", () => {
  it("lists the running panels that started with it, in every project", async () => {
    const profile = createProfile({ agent: "claude", name: "In use" });
    const snapshot = { id: profile.id, name: profile.name, model: "", effort: "" as const, permissionMode: "" as const };
    const app = projects.create("app", `/work/uses-${Math.random()}`);
    const web = projects.create("web", `/work/uses-${Math.random()}`);
    const a = panels.create({ projectId: app.id, kind: "claude", title: "Fix login", sessionId: `s-${Math.random()}`, profile: snapshot });
    const b = panels.create({ projectId: web.id, kind: "claude", title: "Claude Code", profile: snapshot });
    const ended = panels.create({ projectId: web.id, kind: "claude", title: "Old", profile: snapshot });
    panels.create({ projectId: app.id, kind: "claude", title: "Other" }); // no profile
    running.add(a.id).add(b.id);
    void ended; // not running: left out
    const uses = await profileUses(profile.id);
    expect(uses).toHaveLength(2);
    expect(uses).toContainEqual({ panelId: a.id, projectId: app.id, projectName: "app", kind: "claude", title: "Fix login", sessionId: a.sessionId });
    expect(uses).toContainEqual({ panelId: b.id, projectId: web.id, projectName: "web", kind: "claude", title: "Claude Code" });
    await expect(profileUses("nope")).rejects.toThrow("Not found");
  });
});
