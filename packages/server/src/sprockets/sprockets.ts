// Sprockets: always-on agents (ADR 0005, 0006): their look, name, chats and settings. A Sprocket is
// attached to at most one project. It has its direct chat, and while it's attached its project's chat, where Rails'
// events land (ADR 0021); moving it (or detaching it) deletes that project chat, while its direct chat, name, look,
// description and core memory stay. Replies are written by runs.ts. Core memory is the
// Sprocket's own (it edits it with the remember tool) and never leaves the server.
import {
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  SPROCKET_DESCRIPTION_MAX,
  SPROCKET_RULE_MAX,
  SPROCKET_RULES_MAX,
  type Sprocket,
  type SprocketEvent,
  type SprocketInput,
  type SprocketLook,
  type SprocketChatInfo,
  type SprocketMessage,
  type SprocketSettings,
} from "@rails/shared";
import { handoffs, mcpServers, projects, sprocketChats, sprocketMessages, sprocketTools, sprockets, suggestions, usage, type StoredChat } from "../db.ts";
import { customizeChanged } from "../customize/customize.ts";
import { skillExists } from "../customize/skills.ts";
import { ServiceError } from "../errors.ts";
import { nameClash, onTeamsChanged, readOf, stopTeam, wakeTeam } from "./teams.ts";
import { settleHandoffs } from "../coordination/handoffs.ts";
import { projectOwners } from "../coordination/owners.ts";
import { findModel } from "../settings/models.ts";
import { answerWaiting, isRunning, onRunsChanged, requestReply, runningChat, userMessageTime } from "./runs.ts";
import { expireInChat, onSuggestionsChanged } from "../coordination/suggestions.ts";
import { listeners } from "../util.ts";

const MAX_NAME = 40;
const MAX_MESSAGE = 4000;

// ---- change notifications (the terminal hub forwards these to every browser) ----
const sprocketChanges = listeners();
export const onSprocketsChanged = sprocketChanges.on;
const changed = sprocketChanges.emit;
onRunsChanged(changed);
onSuggestionsChanged(changed);
onTeamsChanged(changed);

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** A look from a request. Unknown ids are refused, so a stale client can't store junk; anything else is dropped. */
function parseLook(raw: unknown): SprocketLook {
  const look = (raw ?? {}) as Record<string, unknown>;
  if (!isOneOf(SPROCKET_CHARACTERS, look.character)) throw new ServiceError("Unknown character", 400);
  if (!isOneOf(SPROCKET_COLORS, look.color)) throw new ServiceError("Unknown colour", 400);
  return { character: look.character, color: look.color };
}

/**
 * A stored look, with ids that no longer exist replaced by defaults instead of breaking the page. Looks saved before
 * accessories went (ADR 0005's amendment) still have one; it's dropped. Bean and Lune became Blob and Drop (ADR 0005's
 * amendment of 2026-10-25), the round characters nearest them.
 */
const RENAMED: Record<string, string> = { bean: "blob", lune: "drop" };

function repairLook(raw: unknown): SprocketLook {
  const look = (raw ?? {}) as Record<string, unknown>;
  const character = RENAMED[String(look.character)] ?? look.character;
  return {
    character: isOneOf(SPROCKET_CHARACTERS, character) ? character : "block",
    color: isOneOf(SPROCKET_COLORS, look.color) ? look.color : "yellow",
  };
}

function parseInput(body: Partial<SprocketInput> | undefined): SprocketInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > MAX_NAME) throw new ServiceError(`Names can be at most ${MAX_NAME} characters.`, 400);
  return { name, look: parseLook(body?.look) };
}

function chatInfo(chat: StoredChat): SprocketChatInfo {
  const last = sprocketMessages.last(chat.id);
  return { id: chat.id, kind: chat.kind, running: runningChat(chat.sprocketId) === chat.id, pending: suggestions.pendingIn(chat.id), ...(last ? { lastMessage: last } : {}), ...readOf(chat) };
}

function withLook({ coreMemory: _internal, ...row }: ReturnType<typeof sprockets.list>[number]): Sprocket {
  const project = sprocketChats.of(row.id, "project");
  return {
    ...row,
    look: repairLook(row.look),
    pending: suggestions.pendingPanels(row.id),
    handoffs: row.coordinator ? handoffs.pending(row.id).map(({ sprocketId: _s, ...h }) => h) : [],
    owners: row.projectId ? projectOwners(row.projectId) : [],
    usage: usage.total(row.id),
    running: isRunning(row.id),
    direct: chatInfo(sprocketChats.of(row.id, "direct")!),
    ...(project ? { projectChat: chatInfo(project) } : {}),
    tools: sprocketTools.of(row.id),
  };
}

function getSprocket(id: string): Sprocket {
  const row = sprockets.get(id);
  if (!row) throw new ServiceError("Not found", 404);
  return withLook(row);
}

export function listSprockets(): Sprocket[] {
  return sprockets.list().map(withLook);
}

/** Make a Sprocket. With `introduce` (the app's creator) it says hello in its direct chat and asks what to start with. */
export function createSprocket(body: Partial<SprocketInput> | undefined, { introduce = false } = {}): Sprocket {
  const { name, look } = parseInput(body);
  const created = withLook(sprockets.create(name, look));
  changed();
  const direct = introduce ? sprocketChats.of(created.id, "direct") : undefined;
  if (direct) requestReply(direct.id, created.id, { trigger: "intro" });
  return created;
}

export function updateSprocket(id: string, body: Partial<SprocketInput> | undefined): Sprocket {
  getSprocket(id);
  const { name, look } = parseInput(body);
  const clash = nameClash(id, name);
  if (clash) throw new ServiceError(clash, 409);
  sprockets.update(id, name, look);
  changed();
  return getSprocket(id);
}

/** Delete a Sprocket, its chats and their messages. It leaves its teams, where what it wrote stays (ADR 0022). */
export function deleteSprocket(id: string): void {
  getSprocket(id);
  sprockets.remove(id);
  settleHandoffs();
  changed();
}

function getChat(chatId: string): StoredChat {
  const chat = sprocketChats.get(chatId);
  if (!chat) throw new ServiceError("Not found", 404);
  return chat;
}

/** A Sprocket's direct chat (ADR 0021): every Sprocket has one. */
export function directChat(sprocketId: string): string {
  getSprocket(sprocketId);
  return sprocketChats.of(sprocketId, "direct")!.id;
}

/** The chat of the project a Sprocket is attached to. */
export function projectChat(sprocketId: string): string {
  getSprocket(sprocketId);
  const chat = sprocketChats.of(sprocketId, "project");
  if (!chat) throw new ServiceError("It isn't attached to a project.", 404);
  return chat.id;
}

/** The user is looking at a chat (on some device): what's in it is read, everywhere. */
export function readChat(chatId: string): void {
  const chat = getChat(chatId);
  sprocketChats.markRead(chatId, new Date().toISOString());
  if (readOf(chat).unread) changed();
}

export function listMessages(chatId: string): SprocketMessage[] {
  getChat(chatId);
  return sprocketMessages.list(chatId);
}

/** Store the user's message in a chat and ask its Sprocket to reply there (in a team, whoever's turn it is). */
export function sendMessage(chatId: string, rawText: unknown): SprocketMessage {
  const chat = getChat(chatId);
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) throw new ServiceError("Message is empty", 400);
  if (text.length > MAX_MESSAGE) throw new ServiceError(`Messages can be at most ${MAX_MESSAGE} characters.`, 400);
  const message = sprocketMessages.create(chatId, "user", text, userMessageTime(chatId));
  sprocketChats.markRead(chatId, message.createdAt); // writing in it, you've seen it
  changed();
  if (chat.kind === "team") wakeTeam(chatId, text, message.id);
  else {
    answerWaiting(chatId, text); // a question with options it asked here (ADR 0023)
    requestReply(chatId, undefined, { trigger: "user", sourceId: message.id });
  }
  return message;
}

/**
 * Start a chat over (ADR 0021): its messages go, and suggestions that waited under them expire. The Sprocket's core
 * memory, handoffs and owners stay; a reply it was writing there is dropped.
 */
export function clearChat(chatId: string): void {
  getChat(chatId);
  stopTeam(chatId);
  expireInChat(chatId);
  sprocketChats.clear(chatId);
  changed();
}

/**
 * A session in a Coordinator's project waits for the user (watches.ts): put it in the project chat and wake the
 * Coordinator there. With `wake: false` (an agent's draft, ADR 0018) it only goes in the chat: the Coordinator reads
 * it when it next runs there.
 */
export function postEvent(sprocketId: string, event: SprocketEvent, text: string, { wake = true } = {}): SprocketMessage {
  const chatId = projectChat(sprocketId);
  const message = sprocketMessages.create(chatId, "event", text, userMessageTime(chatId), { event });
  changed();
  if (wake) requestReply(chatId, undefined, { trigger: "event", sourceId: message.id });
  return message;
}

/**
 * Change a Sprocket's project, model, description or rules. Every field is checked before any is applied,
 * so a rejected request changes nothing (moving a Sprocket deletes its chat). A project has one Sprocket, its
 * Coordinator (ADR 0016): attaching makes it that, and a project that has one already is taken.
 */
export function updateSettings(id: string, body: SprocketSettings | undefined): Sprocket {
  const s = getSprocket(id);
  const { projectId, model, description, rules, tools } = body ?? {};
  const moving = projectId !== undefined && (projectId ?? undefined) !== s.projectId;
  if (moving) {
    const to = projectId === null ? undefined : typeof projectId === "string" ? projects.get(projectId) : undefined;
    if (projectId !== null && !to) throw new ServiceError("Unknown project", 400);
    const holder = to && sprockets.byProject(to.id)[0];
    if (holder) throw new ServiceError(`${holder.name} already looks after ${to.name}. Detach it first.`, 409);
    if (isRunning(id)) throw new ServiceError(`${s.name} is replying. Try again when it's done.`, 409);
  }
  if (model !== undefined && model !== null && (typeof model !== "string" || !findModel(model))) throw new ServiceError("Unknown model", 400);
  if (description !== undefined) {
    if (typeof description !== "string") throw new ServiceError("The description must be text", 400);
    if (description.trim().length > SPROCKET_DESCRIPTION_MAX)
      throw new ServiceError(`Descriptions can be at most ${SPROCKET_DESCRIPTION_MAX} characters.`, 400);
  }
  const ruleList = rules === undefined ? undefined : parseRules(rules);
  const toolbox = tools === undefined ? undefined : parseTools(tools);

  if (moving) sprockets.setProject(id, projectId ?? null);
  if (model !== undefined) sprockets.setModel(id, model);
  if (description !== undefined) sprockets.setDescription(id, description.trim());
  if (ruleList) sprockets.setRules(id, ruleList);
  if (toolbox?.mcp) sprocketTools.set(id, "mcp", toolbox.mcp);
  if (toolbox?.skills) sprocketTools.set(id, "skill", toolbox.skills);
  if (toolbox) customizeChanged(); // who uses what shows in Customize
  if (moving) settleHandoffs(); // its handoffs belong to the project it left
  changed();
  return getSprocket(id);
}

/** The MCP servers and skills a request gives a Sprocket (ADR 0025): known ones only. */
function parseTools(raw: unknown): { mcp?: string[]; skills?: string[] } {
  const t = (raw ?? {}) as { mcp?: unknown; skills?: unknown };
  const ids = (v: unknown, known: (id: string) => boolean, what: string) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ServiceError(`${what} must be a list`, 400);
    const bad = v.find((x) => !known(x));
    if (bad) throw new ServiceError(`Unknown ${what === "Servers" ? "MCP server" : "skill"}: ${bad}`, 400);
    return v as string[];
  };
  return { mcp: ids(t.mcp, (id) => !!mcpServers.get(id), "Servers"), skills: ids(t.skills, skillExists, "Skills") };
}

/** Standing rules from a request: trimmed, empty ones dropped, within the limits. */
function parseRules(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.some((r) => typeof r !== "string")) throw new ServiceError("Rules must be a list of sentences", 400);
  const rules = (raw as string[]).map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (rules.length > SPROCKET_RULES_MAX) throw new ServiceError(`A Sprocket can have at most ${SPROCKET_RULES_MAX} rules.`, 400);
  if (rules.some((r) => r.length > SPROCKET_RULE_MAX)) throw new ServiceError(`Rules can be at most ${SPROCKET_RULE_MAX} characters.`, 400);
  return rules;
}

/** A project is being removed from rails: its Sprockets are detached (and their chats there deleted). */
export function detachFromProject(projectId: string): void {
  const attached = sprockets.byProject(projectId);
  for (const s of attached) sprockets.setProject(s.id, null);
  if (attached.length) {
    settleHandoffs();
    changed();
  }
}
