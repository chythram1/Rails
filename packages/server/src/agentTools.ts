// Agent tools (ADR 0018): what an agent in a Rails panel can ask Rails about its project. They're served to the
// agents as an MCP server at /bridge/<panel>/mcp (index.ts), behind the panel's own token, so an agent only ever
// reaches its own project. Claude Code connects it from a flag (bridge/wiring.ts), pi from the Rails extension
// (bridge/pi/rails.ts); Codex gets none yet. Two tools: neighbours (read-only) and message, a draft for another
// session that waits in the Coordinator's chat until the user sends it.
import { shortTitle } from "@rails/shared";
import { AGENT, boardText } from "./bridge/board.ts";
import { cardOf } from "./bridge/index.ts";
import { panels, projects, sprockets, suggestions } from "./db.ts";
import { projectOwners } from "./owners.ts";
import { postEvent } from "./sprockets.ts";
import { MAX_PENDING_MESSAGES, suggest } from "./suggestions.ts";
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

/** Most of one session's drafts that wait for the user at a time. */
const MAX_DRAFTS_FROM_AGENT = 3;

/**
 * An agent drafts a message for another session in its project (ADR 0018). It goes in the Coordinator's chat, an
 * event (which session wants to tell which) with the draft under it, stored as the Coordinator's suggestion with the
 * sender noted, and goes out only when the user sends it. Posting it runs no model. `session` is an id or a title
 * as neighbours shows them.
 */
export async function messageFromAgent(panelId: string, session: unknown, text: unknown): Promise<string> {
  const me = panels.get(panelId);
  const project = me && projects.get(me.projectId);
  if (!me || !project) throw new Error("This panel is closed.");
  if (typeof session !== "string" || !session.trim() || typeof text !== "string") throw new Error("Give the session (its id or title, as neighbours shows them) and the text.");
  const coordinator = sprockets.coordinatorOf(project.id);
  if (!coordinator) throw new Error("Nobody here shows drafts to the user: this project has no Coordinator. Say it in your reply instead.");
  const agents = panels.list(project.id).filter((p) => p.kind !== "shell");
  const titles = new Map(await Promise.all(agents.map(async (p) => [p.id, await sessionTitle(p).catch(() => p.title)] as const)));
  const q = session.trim().replace(/^"(.*)"$/, "$1").toLowerCase();
  const named = (p: (typeof agents)[number]) => [titles.get(p.id)!, shortTitle(titles.get(p.id)!, TITLE_MAX)].some((t) => t.toLowerCase() === q);
  const to = (q.length >= 6 && agents.find((p) => p.id.startsWith(q))) || agents.find(named);
  if (!to) throw new Error(`No other agent session in this project matches "${session}". The neighbours tool lists them.`);
  if (to.id === me.id) throw new Error("That's you: message another session.");
  const toTitle = titles.get(to.id)!;
  if (suggestions.pendingFrom(me.id) >= MAX_DRAFTS_FROM_AGENT)
    throw new Error(`${MAX_DRAFTS_FROM_AGENT} of your messages wait for your user already: draft another once they've sent or dismissed one.`);
  if (suggestions.pendingFor(to.id).filter((s) => s.sprocketId === coordinator.id && s.mode === "message").length >= MAX_PENDING_MESSAGES)
    throw new Error(`${MAX_PENDING_MESSAGES} messages already wait for "${toTitle}". Say it in your reply instead, or try later.`);
  const from = { panelId: me.id, kind: me.kind, title: titles.get(me.id)! };
  const draft = suggest(coordinator.id, to, toTitle, text, { purpose: "message", from });
  const event = postEvent(
    coordinator.id,
    { ...from, ...(me.sessionId ? { sessionId: me.sessionId } : {}), what: "message", to: { panelId: to.id, kind: to.kind, title: toTitle, ...(to.sessionId ? { sessionId: to.sessionId } : {}) } },
    draft.text,
    { wake: false },
  );
  suggestions.attach([draft.id], event.id);
  return `Drafted. Your user sees it in ${coordinator.name}'s chat and decides whether to send it to "${toTitle}", which then gets it from them. Nothing reaches it before that, so don't wait for an answer: carry on with your work.`;
}

const TOOLS = [
  {
    name: "neighbours",
    description:
      "The other coding sessions in this project (run by Rails): what each is doing, the files it changed lately, its last reply, and who owns which files. Read-only. Check it before you change files another session may be working on or owns.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Other sessions in this project", readOnlyHint: true },
    // Claude Code defers MCP tools behind its tool search (the agent sees only their names) unless a tool asks to
    // be loaded up front (verified with 2.1.305). `_meta` is MCP's place for such keys: pi's client skips it.
    _meta: { "anthropic/alwaysLoad": true },
  },
  {
    name: "message",
    description:
      "Draft a message for another coding session in this project: something it needs to know or do, such as a change you made that its code depends on, or a fix in files it owns. Your user reads the draft and decides whether to send it (edited or not), so it may reach the session later or not at all. It isn't for questions to your user: ask them in your reply.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: 'The session: its id or its title, as neighbours shows them (e.g. "1a2b3c4d").' },
        text: { type: "string", description: "The message, written to that session. It's told which session wrote it." },
      },
      required: ["session", "text"],
      additionalProperties: false,
    },
    annotations: { title: "Draft a message for another session", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: { "anthropic/alwaysLoad": true },
  },
];

/** The agent puts these in its prompt (Claude Code under "MCP Server Instructions"): when to call, not only what. */
const INSTRUCTIONS =
  "Rails runs this session alongside other coding sessions in the same project, which may be changing the same code. Call the neighbours tool when you start a task and before you change files outside what you were asked to work on: it shows what the other sessions are doing, the files they changed lately and who owns which files. When another session needs to know something or do something (a change its code depends on, a fix in files it owns), draft it with the message tool instead of changing its files; your user decides whether to send it.";

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
      const name = m.params?.name;
      const args = m.params?.arguments ?? {};
      if (name !== "neighbours" && name !== "message") return error(-32602, `No tool "${name}".`);
      try {
        const text = name === "neighbours" ? await neighboursText(panelId) : await messageFromAgent(panelId, args.session, args.text);
        return ok({ content: [{ type: "text", text }] });
      } catch (e: any) {
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    default:
      return error(-32601, `No method "${m.method}".`);
  }
}
