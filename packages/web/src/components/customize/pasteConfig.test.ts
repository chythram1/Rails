import { describe, expect, it } from "vitest";
import { readPastedConfig, shellWords, type PastedServer } from "./pasteConfig.ts";

const one = (text: string): PastedServer => {
  const r = readPastedConfig(text);
  if ("error" in r) throw new Error(r.error);
  expect(r.servers).toHaveLength(1);
  return r.servers[0];
};

describe("reading a pasted server config", () => {
  it("reads the mcpServers JSON from a README, leaving placeholders to fill in", () => {
    const s = one(`{
      "mcpServers": {
        "Brave Search": {
          "command": "npx",
          "args": ["-y", "@brave/brave-search-mcp-server"],
          "env": { "BRAVE_API_KEY": "<YOUR_API_KEY>", "LOG": "info" },
        },
      }
    }`);
    expect(s).toEqual({
      name: "brave-search",
      transport: "stdio",
      url: "",
      command: "npx",
      args: ["-y", "@brave/brave-search-mcp-server"],
      env: { BRAVE_API_KEY: "", LOG: "info" },
      headers: {},
      missing: ["BRAVE_API_KEY"],
      checkArgs: [],
    });
  });

  it("reads the inside of an object, VS Code's servers, a single server and remote ones with headers", () => {
    expect(one(`"filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/files"] }`).checkArgs).toEqual(["/path/to/allowed/files"]);
    expect(one(`{ "servers": { "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" } } }`)).toMatchObject({ name: "linear", transport: "http", url: "https://mcp.linear.app/mcp" });
    expect(one(`{ "command": "uvx", "args": ["mcp-server-git"] }`)).toMatchObject({ name: "server", command: "uvx" });
    expect(one(`{ "mcpServers": { "tracker": { "url": "https://x.dev/mcp", "headers": { "Authorization": "Bearer \${TRACKER_TOKEN}" } } } }`)).toMatchObject({ headers: { Authorization: "" }, missing: ["Authorization"] });
    const r = readPastedConfig(`{ "mcpServers": { "a": { "command": "a" }, "b": { "url": "https://b.dev/mcp" } } }`);
    expect("servers" in r && r.servers.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("refuses SSE servers and says why", () => {
    expect(readPastedConfig(`{ "mcpServers": { "old": { "type": "sse", "url": "https://x.dev/sse" } } }`)).toEqual({ error: expect.stringContaining("SSE") });
  });

  it("reads claude mcp add lines", () => {
    expect(one(`claude mcp add --transport http notion https://mcp.notion.com/mcp`)).toMatchObject({ name: "notion", transport: "http", url: "https://mcp.notion.com/mcp" });
    expect(one(`claude mcp add -t http -H "Authorization: Bearer abc123" sentry https://mcp.sentry.dev/mcp`)).toMatchObject({ headers: { Authorization: "Bearer abc123" }, missing: [] });
    expect(one(`$ claude mcp add airtable -e AIRTABLE_API_KEY=YOUR_KEY -s user -- npx -y airtable-mcp-server`)).toMatchObject({
      name: "airtable",
      command: "npx",
      args: ["-y", "airtable-mcp-server"],
      env: { AIRTABLE_API_KEY: "" },
      missing: ["AIRTABLE_API_KEY"],
    });
    expect(one(`claude mcp add-json weather '{"type":"stdio","command":"/path/to/weather-cli","args":["--api-key","abc"]}'`)).toMatchObject({ name: "weather", command: "/path/to/weather-cli" });
  });

  it("reads codex mcp add lines and Codex's TOML", () => {
    expect(one(`codex mcp add context7 --env TOKEN=abc -- npx -y @upstash/context7-mcp`)).toMatchObject({ name: "context7", command: "npx", args: ["-y", "@upstash/context7-mcp"], env: { TOKEN: "abc" } });
    expect(one(`codex mcp add figma --url https://mcp.figma.com/mcp --bearer-token-env-var FIGMA_TOKEN`)).toMatchObject({ transport: "http", missing: ["Authorization"] });
    expect(
      one(`[mcp_servers.github]
command = "docker"
args = ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "ghcr.io/github/github-mcp-server"]

[mcp_servers.github.env]
GITHUB_TOKEN = "<your-token>"`),
    ).toMatchObject({ name: "github", command: "docker", args: ["run", "-i", "--rm", "-e", "GITHUB_TOKEN", "ghcr.io/github/github-mcp-server"], missing: ["GITHUB_TOKEN"] });
  });

  it("splits command lines as a shell would", () => {
    expect(shellWords(`a "b c" 'd e' f\\ g \\\n h`)).toEqual(["a", "b c", "d e", "f g", "h"]);
  });

  it("says what it takes when it can't read something", () => {
    expect(readPastedConfig("npx -y something")).toEqual({ error: expect.stringContaining("claude mcp add") });
    expect(readPastedConfig("  ")).toEqual({ error: "Paste a config first." });
  });
});
