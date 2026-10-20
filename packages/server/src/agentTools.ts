// Agent tools (ADR 0018): what an agent in a Rails panel can ask Rails about its project. They're served to the
// agents as an MCP server at /bridge/<panel>/mcp (index.ts), behind the panel's own token, so an agent only ever
// reaches its own project. Claude Code connects it from a flag (bridge/wiring.ts), pi from the Rails extension
// (bridge/pi/rails.ts); Codex gets none yet. For now one read-only tool: neighbours.
import { shortTitle } from "@rails/shared";
import { AGENT, boardText } from "./bridge/board.ts";
import { cardOf } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";
import { projectOwners } from "./owners.ts";
import { sessionTitle } from "./titles.ts";

/** Titles are often a session's whole first prompt: agents get them cut short. */
const TITLE_MAX = 60;

/**
 * The other agent sessions in the panel's project, for the agent in it: each one's status, the files it changed
 * lately and its last reply (`boardText` for agents), then who owns which files. Not the agent itself, shells or
 * other projects, nor what the user asked a session or the commands it ran.
 */
export async function neighboursText(panelId: string): Promise<string> {
  const me = panels.get(panelId);
  const project = me && projects.get(me.projectId);
  if (!me || !project) throw new Error("This panel is closed.");
  const agents = panels.list(project.id).filter((p) => p.kind !== "shell");
  const titles = new Map(await Promise.all(agents.map(async (p) => [p.id, shortTitle(await sessionTitle(p).catch(() => p.title), TITLE_MAX)] as const)));
  const cards = agents.filter((p) => p.id !== me.id).map((p) => ({ ...cardOf(p), title: titles.get(p.id) ?? p.title }));
  const lines = [`You are "${titles.get(me.id)}" (${AGENT[me.kind]}, id ${me.id.slice(0, 8)}).`, boardText(project, cards, Date.now(), 6000, { forAgent: true })];
  const owners = projectOwners(project.id);
  if (owners.length)
    lines.push(
      ["Who owns which files (the user set this):", ...owners.map((o) => `- ${o.panelId === me.id ? "you" : `"${titles.get(o.panelId) ?? o.title}"`}: ${o.paths.join(", ")}`)].join("\n"),
    );
  return lines.join("\n\n");
}

const TOOLS = [
  {
    name: "neighbours",
    description:
      "The other coding sessions in this project (run by Rails): what each is doing, the files it changed lately, its last reply, and who owns which files. Read-only. Check it before you change files another session may be working on or owns.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Other sessions in this project", readOnlyHint: true },
  },
];

const INSTRUCTIONS =
  "Rails runs this session alongside other coding sessions in the same project. The neighbours tool shows what they're doing and which files they changed or own.";

type Rpc = { jsonrpc: "2.0"; id: string | number; result?: unknown; error?: { code: number; message: string } };

/**
 * Answer one MCP request (JSON-RPC 2.0, the Streamable HTTP transport's JSON replies) from the agent in a panel:
 * initialize, ping, tools/list and tools/call. Notifications get no reply (undefined).
 */
export async function mcpRequest(panelId: string, msg: unknown): Promise<Rpc | undefined> {
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: any } | null;
  const id = typeof m?.id === "string" || typeof m?.id === "number" ? m.id : null;
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } }) as Rpc;
  // One request per POST (no batches); a notification is a request without an id, and nothing else is one.
  if (!m || typeof m !== "object" || Array.isArray(m) || m.jsonrpc !== "2.0" || typeof m.method !== "string") return error(-32600, "Not a JSON-RPC 2.0 request.");
  if (!("id" in m)) return undefined; // a notification
  if (id === null) return error(-32600, "A request's id must be a string or a number.");
  const ok = (result: unknown): Rpc => ({ jsonrpc: "2.0", id, result });
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "rails", version: "1" },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      if (m.params?.name !== "neighbours") return error(-32602, `No tool "${m.params?.name}".`);
      try {
        return ok({ content: [{ type: "text", text: await neighboursText(panelId) }] });
      } catch (e: any) {
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    default:
      return error(-32601, `No method "${m.method}".`);
  }
}
