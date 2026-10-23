// A tiny MCP server over stdio for tests and checks (ADR 0025): a notes store with a read-only tool and an acting
// one (and a destructive one). `node fake-mcp.mjs`; FAKE_MCP_FAIL=1 makes it exit at once, FAKE_MCP_TOKEN is echoed by whoami.
import { createInterface } from "node:readline";

if (process.env.FAKE_MCP_FAIL) {
  process.stderr.write("fake-mcp: told to fail\n");
  process.exit(1);
}

const notes = [{ id: 1, text: "Buy milk" }];
const tools = [
  {
    name: "list_notes",
    description: "List the notes.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_note",
    description: "Add a note.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The note." } }, required: ["text"] },
  },
  {
    name: "clear_notes",
    description: "Delete every note.",
    inputSchema: { type: "object", properties: {} },
    annotations: { destructiveHint: true },
  },
  {
    name: "whoami",
    description: "Say which token it was started with.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
];

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const m = JSON.parse(line);
  if (m.id === undefined) return; // a notification
  switch (m.method) {
    case "initialize":
      return send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-notes", version: "1.0.0" } } });
    case "ping":
      return send({ id: m.id, result: {} });
    case "tools/list":
      return send({ id: m.id, result: { tools } });
    case "tools/call": {
      const { name, arguments: args = {} } = m.params;
      if (name === "list_notes") return send({ id: m.id, result: text(notes.map((n) => `${n.id}. ${n.text}`).join("\n")) });
      if (name === "add_note") {
        if (!args.text) return send({ id: m.id, result: text("A note needs text.", true) });
        notes.push({ id: notes.length + 1, text: String(args.text) });
        return send({ id: m.id, result: text(`Added note ${notes.length}.`) });
      }
      if (name === "clear_notes") return send({ id: m.id, result: text(`Deleted ${notes.splice(0).length} notes.`) });
      if (name === "whoami") return send({ id: m.id, result: text(`token=${process.env.FAKE_MCP_TOKEN ?? "none"} rails=${process.env.RAILS_TOKEN ?? "none"}`) });
      return send({ id: m.id, error: { code: -32602, message: `Unknown tool ${name}` } });
    }
    default:
      return send({ id: m.id, error: { code: -32601, message: `Unknown method ${m.method}` } });
  }
});
