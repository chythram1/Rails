import { describe, expect, it } from "vitest";
import { createAgentProfile, deleteAgentProfile, getAgentProfile, launchProfile, listAgentProfiles, profileFlags, updateAgentProfile } from "./agentProfiles.ts";

describe("agent profiles", () => {
  it("creates one with defaults, numbering the default name", () => {
    const a = createAgentProfile();
    const b = createAgentProfile();
    expect(a.name).toBe("New agent profile");
    expect(b.name).toBe("New agent profile 2");
    expect(a).toMatchObject({ provider: "claude", model: "", effort: "", permissionMode: "", skills: [], mcpServers: [], mcpOnly: false, isDefault: false });
  });

  it("updates some fields and keeps the rest", () => {
    const p = createAgentProfile({ name: "Research", model: "opus" });
    const after = updateAgentProfile(p.id, { instructions: "Cite sources." });
    expect(after).toMatchObject({ name: "Research", model: "opus", instructions: "Cite sources." });
  });

  it("refuses a taken name, ignoring case", () => {
    createAgentProfile({ name: "Frontend" });
    expect(() => createAgentProfile({ name: "frontend" })).toThrow("Another agent profile is called Frontend.");
    const other = createAgentProfile({ name: "Frontend 2" });
    expect(() => updateAgentProfile(other.id, { name: "FRONTEND" })).toThrow("Another agent profile");
  });

  it("checks fields", () => {
    expect(() => createAgentProfile({ name: "x".repeat(41) })).toThrow("at most 40");
    expect(() => createAgentProfile({ name: "P1", provider: "pi" })).toThrow("Claude Code for now");
    expect(() => createAgentProfile({ name: "P2", permissionMode: "yolo" })).toThrow("Unknown permission mode");
    expect(() => createAgentProfile({ name: "P2b", effort: "huge" })).toThrow("Unknown effort level");
    expect(() => createAgentProfile({ name: "P3", model: "opus; rm -rf" })).toThrow("model name");
    expect(() => createAgentProfile({ name: "P4", allowedTools: ["--dangerously-skip-permissions"] })).toThrow("isn't a tool pattern");
    expect(() => createAgentProfile({ name: "P5", skills: [{ source: "library", name: "../etc" }] })).toThrow("Unknown skill");
    expect(() => createAgentProfile({ name: "P6", mcpServers: [{ name: "a", type: "stdio" }] })).toThrow("needs a command");
    expect(() => createAgentProfile({ name: "P7", mcpServers: [{ name: "a", type: "http", url: "file:///x" }] })).toThrow("http or https URL");
    expect(() => createAgentProfile({ name: "P8", mcpServers: [{ name: "a", type: "http", url: "http://x" }, { name: "a", type: "sse", url: "http://y" }] })).toThrow("Two MCP servers");
  });

  it("dedupes tools and skills and drops empty patterns", () => {
    const p = createAgentProfile({ name: "Dedupe", allowedTools: ["Read", " Read ", ""], skills: [{ source: "user", name: "a" }, { source: "user", name: "a" }] });
    expect(p.allowedTools).toEqual(["Read"]);
    expect(p.skills).toHaveLength(1);
  });

  it("keeps one default per agent, and the picked profile wins over it", () => {
    const a = createAgentProfile({ name: "Default A", isDefault: true });
    const b = createAgentProfile({ name: "Default B" });
    expect(launchProfile("claude", undefined)?.id).toBe(a.id);
    updateAgentProfile(b.id, { isDefault: true });
    expect(listAgentProfiles().filter((p) => p.isDefault).map((p) => p.id)).toEqual([b.id]);
    expect(launchProfile("claude", undefined)?.id).toBe(b.id);
    expect(launchProfile("claude", a.id)?.id).toBe(a.id);
    expect(() => launchProfile("pi", a.id)).toThrow("isn't a profile for this agent");
    expect(() => launchProfile("shell", a.id)).toThrow("Shells");
    expect(launchProfile("pi", undefined)).toBeUndefined();
    deleteAgentProfile(b.id);
    expect(launchProfile("claude", undefined)).toBeUndefined();
  });

  it("deletes", () => {
    const p = createAgentProfile({ name: "Temp" });
    deleteAgentProfile(p.id);
    expect(() => getAgentProfile(p.id)).toThrow("not found");
    expect(listAgentProfiles().some((x) => x.id === p.id)).toBe(false);
  });

  it("turns MCP servers into --mcp-config, with --strict-mcp-config for only these", async () => {
    const p = createAgentProfile({
      name: "MCP",
      mcpOnly: true,
      mcpServers: [
        { name: "files", type: "stdio", command: "npx", args: ["server"], env: { TOKEN: "${TOKEN}" } },
        { name: "docs", type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
      ],
    });
    const { argv } = await profileFlags(p, "panel-1", "/work/x");
    const config = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]);
    expect(config.mcpServers.files).toEqual({ type: "stdio", command: "npx", args: ["server"], env: { TOKEN: "${TOKEN}" } });
    expect(config.mcpServers.docs).toEqual({ type: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } });
    expect(argv).toContain("--strict-mcp-config");
  });
});
