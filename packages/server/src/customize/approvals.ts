// Approvals (ADR 0025): a Sprocket asked to call an MCP tool set to ask. The user allows it (Rails makes the call
// and keeps the result on the card) or denies it; either way the Sprocket gets a new turn to go on. The card is the
// record, so nothing waits in memory while the user decides.
import { RESULT_CHARS, callTool, policyOf } from "./mcp.ts";
import { mcpServers, sprocketMessages, sprocketRuns, sprocketTools } from "../db.ts";
import { ServiceError } from "../errors.ts";
import { requestReply, runsChanged } from "../sprockets/runs.ts";

/** Decisions under way, so a double tap (or two devices) can't run a call twice. */
const deciding = new Set<string>();

export async function decideApproval(messageId: string, allow: unknown): Promise<void> {
  if (typeof allow !== "boolean") throw new ServiceError("Say whether to allow it", 400);
  const m = sprocketMessages.get(messageId);
  if (!m?.approval) throw new ServiceError("Not found", 404);
  if (m.approval.status !== "pending" || deciding.has(messageId)) throw new ServiceError("It was already decided.", 409);
  deciding.add(messageId);
  try {
    const a = m.approval;
    const set = (next: Partial<typeof a>) => {
      sprocketMessages.setApproval(messageId, { ...a, ...next });
      runsChanged();
    };
    if (!allow) set({ status: "denied" });
    else {
      // It may have changed since it was asked: the server gone, taken from the Sprocket, or the tool turned off.
      const server = mcpServers.get(a.serverId);
      const tool = server?.tools.find((t) => t.name === a.tool);
      if (!server || !tool || !sprocketTools.of(m.sprocketId).mcp.includes(server.id) || policyOf(server, tool) === "off")
        set({ status: "failed", result: `${a.server} ${a.tool} isn't available to it any more.` });
      else {
        set({ status: "running" });
        try {
          const r = await callTool(server.id, tool.name, a.args);
          set({ status: r.isError ? "failed" : "done", result: r.text.slice(0, RESULT_CHARS) });
        } catch (e) {
          set({ status: "failed", result: (e as Error).message.slice(0, 1000) });
        }
      }
    }
    // Its run no longer waits; it goes on in a new one, with what came of it.
    const runId = sprocketMessages.runOf(messageId);
    if (runId && sprocketRuns.get(runId)?.status === "waiting") sprocketRuns.setStatus(runId, "done");
    requestReply(m.chatId, m.sprocketId, { trigger: "approval", sourceId: messageId });
  } finally {
    deciding.delete(messageId);
  }
}
