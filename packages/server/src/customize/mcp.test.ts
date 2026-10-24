// MCP servers (ADR 0025): the library, secrets kept on the server, connecting over stdio, tools and their settings.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { RAILS_HOME } from "../config.ts";
import { addConnector, callTool, createServer, deleteServer, disconnectAll, listServers, policyOf, testServer, updateServer } from "./mcp.ts";

const FAKE = fileURLToPath(new URL("../test/fake-mcp.mjs", import.meta.url));
/** A server running the fake notes server. */
export const fakeServer = (name: string, env: Record<string, string> = {}) => createServer({ name, transport: "stdio", command: process.execPath, args: [FAKE], env });

afterAll(() => disconnectAll());

describe("MCP servers", () => {
  it("checks names, URLs and values", () => {
    expect(() => createServer({ name: "Has Space" })).toThrow("lowercase");
    fakeServer("dup");
    expect(() => fakeServer("dup")).toThrow("already a server called dup");
    expect(() => createServer({ name: "web", transport: "http", url: "ftp://x" })).toThrow("https://");
    expect(() => createServer({ name: "bad-env", env: { "1X": "a" } })).toThrow("valid variable name");
    expect(() => createServer({ name: "rails-env", env: { RAILS_TOKEN: "a" } })).toThrow("Rails' own");
    expect(createServer({}).name).toMatch(/^server/);
  });

  it("keeps secret values on the server: browsers see only their names", () => {
    const s = createServer({ name: "secret", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer abc" } });
    expect(s.headers).toEqual(["Authorization"]);
    expect(JSON.stringify(listServers())).not.toContain("Bearer abc");
    const file = join(RAILS_HOME, "mcp-secrets.json");
    expect(readFileSync(file, "utf8")).toContain("Bearer abc");
    expect(statSync(file).mode & 0o077).toBe(0);
    // null removes a value; leaving one out keeps it.
    expect(updateServer(s.id, { headers: { "X-Other": "1" } }).headers).toEqual(["Authorization", "X-Other"]);
    expect(updateServer(s.id, { headers: { Authorization: null } }).headers).toEqual(["X-Other"]);
    deleteServer(s.id);
    expect(readFileSync(file, "utf8")).not.toContain(s.id);
  });

  it("connects over stdio, lists the tools with their default settings, and calls them", async () => {
    const s = fakeServer("notes", { FAKE_MCP_TOKEN: "t0k" });
    const tested = await testServer(s.id);
    expect(tested.status.state).toBe("ok");
    expect(tested.tools.map((t) => [t.name, t.readOnly, t.policy])).toEqual([
      ["list_notes", true, "allow"],
      ["add_note", false, "ask"],
      ["clear_notes", false, "ask"],
      ["whoami", true, "allow"],
    ]);
    expect(await callTool(s.id, "add_note", { text: "Call Ada" })).toEqual({ text: "Added note 2.", isError: false });
    expect((await callTool(s.id, "list_notes", {})).text).toBe("1. Buy milk\n2. Call Ada");
    expect((await callTool(s.id, "add_note", {})).isError).toBe(true);
    // Its own variables reach it; Rails' don't.
    expect((await callTool(s.id, "whoami", {})).text).toBe("token=t0k rails=none");
    // Settings change per tool, only for tools it has.
    expect(updateServer(s.id, { policies: { add_note: "allow", list_notes: "off" } }).tools.map((t) => t.policy)).toEqual(["off", "allow", "ask", "allow"]);
    expect(() => updateServer(s.id, { policies: { nope: "allow" } })).toThrow("no tool called nope");
  });

  it("says why it couldn't connect", async () => {
    const s = fakeServer("broken", { FAKE_MCP_FAIL: "1" });
    const tested = await testServer(s.id);
    expect(tested.status.state).toBe("error");
    expect(tested.status.error).toContain("told to fail");
    expect(existsSync(FAKE)).toBe(true);
  });

  it("adds connectors as ordinary servers, set up as their entry says", async () => {
    await expect(addConnector("nope", {})).rejects.toThrow("Not found");
    await expect(addConnector("github", {})).rejects.toThrow("Paste the personal access token first.");
    // Google's want the user's own app: added, not connected, and remembered as that connector.
    const drive = await addConnector("google-drive", {});
    expect(drive).toMatchObject({ name: "google-drive", connector: "google-drive", transport: "http", url: "https://drivemcp.googleapis.com/mcp/v1" });
    expect(drive.status.state).toBe("unknown");
    expect(drive.signIn?.state).toBe("none");
    // A second one gets the next free name.
    expect((await addConnector("google-drive", {})).name).toBe("google-drive-2");
  });

  it("starts a connector's tools as Allow when its entry says they only read", () => {
    const tool = { name: "ask_wiki_question", description: "", inputSchema: {}, readOnly: false };
    const server = { policies: {} } as Parameters<typeof policyOf>[0];
    expect(policyOf(server, tool)).toBe("ask");
    expect(policyOf({ ...server, connector: "deepwiki" }, tool)).toBe("allow");
    expect(policyOf({ ...server, connector: "deepwiki", policies: { ask_wiki_question: "off" } }, tool)).toBe("off");
  });
});
