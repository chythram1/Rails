import { beforeEach, describe, expect, it, vi } from "vitest";

// tmux and the agents' stores are faked: panels "run" once started, and a session lookup takes a while,
// like the first scan of a large pi store.
const running = new Set<string>();
vi.mock("./tmux.ts", () => ({
  startSession: vi.fn(async (id: string) => void running.add(id)),
  killSession: vi.fn(async (id: string) => void running.delete(id)),
  runningPanels: vi.fn(async () => new Set(running)),
}));
vi.mock("./providers/index.ts", () => ({
  discovery: { pi: { name: "pi" }, claude: { name: "Claude Code" }, codex: { name: "Codex" } },
  installed: () => true,
  findSession: vi.fn(async (provider: string, id: string) => {
    await new Promise((r) => setTimeout(r, 30));
    return { provider, id, cwd: "/work/app", title: "Old session", createdAt: "", updatedAt: "" };
  }),
}));

const { openPanel } = await import("./panels.ts");
const { panels, projects } = await import("./db.ts");

describe("openPanel", () => {
  let projectId: string;
  beforeEach(() => {
    projectId = projects.create("app", `/work/app-${Math.random()}`).id;
  });

  it("opens a session once when two requests race (StrictMode, two devices)", async () => {
    const [a, b] = await Promise.all([
      openPanel(projectId, { kind: "pi", sessionId: "s-race" }),
      openPanel(projectId, { kind: "pi", sessionId: "s-race" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(panels.list(projectId).filter((p) => p.sessionId === "s-race")).toHaveLength(1);
  });

  it("returns the running panel when the session is opened again later", async () => {
    const first = await openPanel(projectId, { kind: "pi", sessionId: "s-again" });
    const again = await openPanel(projectId, { kind: "pi", sessionId: "s-again" });
    expect(again.id).toBe(first.id);
  });

  it("can open the session again after a failed attempt", async () => {
    const { startSession } = await import("./tmux.ts");
    vi.mocked(startSession).mockRejectedValueOnce(new Error("tmux failed"));
    await expect(openPanel(projectId, { kind: "pi", sessionId: "s-fail" })).rejects.toThrow("tmux failed");
    const panel = await openPanel(projectId, { kind: "pi", sessionId: "s-fail" });
    expect(panel.sessionId).toBe("s-fail");
  });
});

describe("openPanel with an agent profile (ADR 0018)", () => {
  let projectId: string;
  beforeEach(() => {
    projectId = projects.create("app", `/work/app-${Math.random()}`).id;
  });

  const lastArgv = async () => {
    const { startSession } = await import("./tmux.ts");
    return vi.mocked(startSession).mock.calls.at(-1)![2];
  };

  it("adds the profile's flags after the bridge's and before the session id", async () => {
    const { createAgentProfile } = await import("./agentProfiles.ts");
    const profile = createAgentProfile({ name: `Frontend ${Math.random()}`, model: "opus", effort: "high", permissionMode: "plan", instructions: "Follow DESIGN.md.", allowedTools: ["Bash(npm test:*)"] });
    const panel = await openPanel(projectId, { kind: "claude", agentProfileId: profile.id });
    const argv = await lastArgv();
    expect(panel.title).toBe(profile.name);
    expect(panel.profile).toEqual({ id: profile.id, name: profile.name, model: "opus", effort: "high", permissionMode: "plan" });
    expect(argv[0]).toBe("claude");
    expect(argv.indexOf("--settings")).toBeLessThan(argv.indexOf("--model"));
    expect(argv.slice(argv.indexOf("--model"), argv.indexOf("--session-id"))).toEqual([
      "--model", "opus", "--effort", "high", "--permission-mode", "plan", "--append-system-prompt", "Follow DESIGN.md.", "--allowedTools", "Bash(npm test:*)",
    ]);
  });

  it("links library skills into a plugin folder for the panel and removes it on close", async () => {
    const { mkdirSync, writeFileSync, existsSync, readlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { SKILLS_DIR, PANEL_PLUGINS_DIR } = await import("./config.ts");
    const { createAgentProfile } = await import("./agentProfiles.ts");
    const { closePanel } = await import("./panels.ts");
    mkdirSync(join(SKILLS_DIR, "zebra"), { recursive: true });
    writeFileSync(join(SKILLS_DIR, "zebra", "SKILL.md"), "---\nname: zebra\ndescription: Zebras.\n---\n");
    const profile = createAgentProfile({ name: `Skills ${Math.random()}`, skills: [{ source: "library", name: "zebra" }, { source: "project", name: "gone" }] });
    const panel = await openPanel(projectId, { kind: "claude", agentProfileId: profile.id });
    const argv = await lastArgv();
    const dir = join(PANEL_PLUGINS_DIR, panel.id);
    expect(argv[argv.indexOf("--plugin-dir") + 1]).toBe(dir);
    expect(readlinkSync(join(dir, "skills", "zebra"))).toBe(join(SKILLS_DIR, "zebra"));
    expect(existsSync(join(dir, "skills", "gone"))).toBe(false);
    await closePanel(panel.id);
    expect(existsSync(dir)).toBe(false);
  });

  it("resumes a session with the profile it started with, and without one once it's deleted", async () => {
    const { createAgentProfile, deleteAgentProfile } = await import("./agentProfiles.ts");
    const { closePanel } = await import("./panels.ts");
    const profile = createAgentProfile({ name: `Backend ${Math.random()}`, model: "sonnet" });
    const first = await openPanel(projectId, { kind: "claude", agentProfileId: profile.id });
    await closePanel(first.id);

    const resumed = await openPanel(projectId, { kind: "claude", sessionId: first.sessionId });
    expect(resumed.profile?.id).toBe(profile.id);
    expect(await lastArgv()).toContain("sonnet");
    await closePanel(resumed.id);

    deleteAgentProfile(profile.id);
    const plain = await openPanel(projectId, { kind: "claude", sessionId: first.sessionId });
    expect(plain.profile).toBeUndefined();
    expect(await lastArgv()).not.toContain("--model");
  });

  it("refuses a profile for another agent", async () => {
    const { createAgentProfile } = await import("./agentProfiles.ts");
    const profile = createAgentProfile({ name: `Claude only ${Math.random()}` });
    await expect(openPanel(projectId, { kind: "pi", agentProfileId: profile.id })).rejects.toThrow("isn't a profile for this agent");
  });

  it("lists the running panels that started with a profile", async () => {
    const { createAgentProfile, profileUses } = await import("./agentProfiles.ts");
    const { closePanel } = await import("./panels.ts");
    const profile = createAgentProfile({ name: `In use ${Math.random()}` });
    const a = await openPanel(projectId, { kind: "claude", agentProfileId: profile.id });
    const b = await openPanel(projectId, { kind: "claude", agentProfileId: profile.id });
    await openPanel(projectId, { kind: "claude" }); // no profile
    await closePanel(b.id);
    expect(await profileUses(profile.id)).toEqual([{ panelId: a.id, projectId, projectName: "app", kind: "claude", title: profile.name, sessionId: a.sessionId }]);
    await expect(profileUses("nope")).rejects.toThrow("not found");
  });

  // Last: a default changes how every later Claude Code panel starts.
  it("starts with the agent's default when none is picked, also when resuming a session started without one", async () => {
    const { createAgentProfile, deleteAgentProfile } = await import("./agentProfiles.ts");
    const { closePanel } = await import("./panels.ts");
    const plain = await openPanel(projectId, { kind: "claude" });
    await closePanel(plain.id);
    const picked = createAgentProfile({ name: `Picked ${Math.random()}`, model: "haiku" });
    const byDefault = createAgentProfile({ name: `Default ${Math.random()}`, model: "sonnet", isDefault: true });

    expect((await openPanel(projectId, { kind: "claude" })).profile?.id).toBe(byDefault.id);
    expect((await openPanel(projectId, { kind: "claude", agentProfileId: picked.id })).profile?.id).toBe(picked.id);
    const resumed = await openPanel(projectId, { kind: "claude", sessionId: plain.sessionId });
    expect(resumed.profile?.id).toBe(byDefault.id);
    expect(await lastArgv()).toContain("sonnet");
    expect((await openPanel(projectId, { kind: "shell" })).profile).toBeUndefined();
    deleteAgentProfile(byDefault.id);
  });
});
