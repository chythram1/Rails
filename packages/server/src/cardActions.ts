// Cards that act (ADR 0031): the user runs or skips the actions a Sprocket's card offers. Run is the approval: Rails
// checks the call is still allowed and makes it on the server, as approvals.ts does, and the card keeps what came of
// it. Once every action has run or been skipped, the Sprocket that showed the card goes on, once, in direct and team
// chats alike (in a team, that member).
import { actionSettled, type SprocketCardAction } from "@rails/shared";
import { mcpServers, sprocketMessages, sprocketTools } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { callTool, policyOf } from "./mcp.ts";
import { requestReply, runsChanged } from "./runs.ts";

/** How much of a call's result a card keeps (it goes to the model with up to four others). */
const ACTION_RESULT_CHARS = 4000;

/** Actions being run, by message and index, so a double tap or a second device can't run one twice. */
const busy = new Set<string>();

function actionsOf(messageId: string): SprocketCardAction[] | undefined {
  return sprocketMessages.get(messageId)?.card?.actions;
}

/** Change one action, from the card as it is now (others may have changed meanwhile). False if the card is gone. */
function patch(messageId: string, index: number, next: Partial<SprocketCardAction>): boolean {
  const actions = actionsOf(messageId);
  if (!actions?.[index]) return false;
  sprocketMessages.setCardActions(
    messageId,
    actions.map((a, i) => (i === index ? { ...a, ...next } : a)),
  );
  runsChanged();
  return true;
}

/** Why the action can't run now, if it can't: its server gone, taken from the Sprocket, or the tool turned off. */
function unavailable(sprocketId: string, a: SprocketCardAction): string | undefined {
  const server = mcpServers.get(a.serverId);
  const tool = server?.tools.find((t) => t.name === a.tool);
  if (!server || !tool || !sprocketTools.of(sprocketId).mcp.includes(server.id) || policyOf(server, tool) === "off")
    return `${a.server} ${a.tool} isn't available to it any more.`;
}

async function runOne(messageId: string, sprocketId: string, index: number): Promise<void> {
  const a = actionsOf(messageId)?.[index];
  if (!a || a.status !== "waiting") return;
  const no = unavailable(sprocketId, a);
  if (no) return void patch(messageId, index, { status: "failed", result: no });
  patch(messageId, index, { status: "running" });
  try {
    const r = await callTool(a.serverId, a.tool, a.args);
    patch(messageId, index, { status: r.isError ? "failed" : "done", result: r.text.slice(0, ACTION_RESULT_CHARS) });
  } catch (e) {
    patch(messageId, index, { status: "failed", result: (e as Error).message.slice(0, 1000) });
  }
}

/**
 * Run or skip a card's action (`index`), or with no index every action still waiting, in order. The Sprocket that
 * showed the card gets a turn once all of them are settled; only the change that settles the last one asks for it.
 */
export async function actOnCard(messageId: string, body: { index?: unknown; run?: unknown } | undefined): Promise<void> {
  const { index, run } = body ?? {};
  if (typeof run !== "boolean") throw new ServiceError("Say whether to run it or skip it", 400);
  const m = sprocketMessages.get(messageId);
  const actions = m?.card?.actions;
  if (!m || !actions?.length) throw new ServiceError("Not found", 404);
  if (index !== undefined && (typeof index !== "number" || !Number.isInteger(index) || !actions[index])) throw new ServiceError("No such action", 400);
  const picked = (index === undefined ? actions.map((_, i) => i) : [index as number]).filter((i) => actions[i].status === "waiting" && !busy.has(`${messageId}:${i}`));
  if (!picked.length) throw new ServiceError(index === undefined ? "Nothing on it is waiting." : "It was already run or skipped.", 409);
  const keys = picked.map((i) => `${messageId}:${i}`);
  for (const k of keys) busy.add(k);
  try {
    for (const i of picked) {
      if (run) await runOne(messageId, m.sprocketId, i);
      else patch(messageId, i, { status: "skipped" });
    }
  } finally {
    for (const k of keys) busy.delete(k);
  }
  // Settled now: its Sprocket goes on with what came of them. Cleared meanwhile: nothing. Another tap still running
  // one of them asks when it's done.
  const now = actionsOf(messageId);
  if (now?.every(actionSettled) && ![...busy].some((k) => k.startsWith(`${messageId}:`)))
    requestReply(m.chatId, m.sprocketId, { trigger: "actions", sourceId: messageId });
}
