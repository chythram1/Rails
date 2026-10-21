// Group chats (ADR 0022): the user and two to four Sprockets, the first the lead. The user's message goes to the
// lead unless it @mentions members; a reply that @mentions others passes the turn to them. Only the user starts a
// round, and a round stops after GROUP_TURNS_MAX turns, so Sprockets can't keep replying to each other. Runs
// themselves are runs.ts's: this decides whose turn it is.
import { GROUP_MEMBERS_MAX, GROUP_MEMBERS_MIN, GROUP_TURNS_MAX, type SprocketGroup, type SprocketGroupInput, type SprocketMessage } from "@rails/shared";
import { sprocketChats, sprocketMessages, sprockets, suggestions, type StoredChat } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { onTurnEnded, requestReply, runningChat, userMessageTime } from "./runs.ts";
import { expireInChat } from "./suggestions.ts";
import { listeners } from "./util.ts";

const MAX_NAME = 40;

const groupChanges = listeners();
/** A group was made, edited or deleted. */
export const onGroupsChanged = groupChanges.on;
const changed = groupChanges.emit;

/** The turns still to come after the user's latest message in a group, and how many were taken. */
type Round = { queue: string[]; turns: number };
const rounds = new Map<string, Round>();
/** The member whose turn is going in each group, and the round it belongs to. */
const active = new Map<string, { sprocketId: string; round: Round }>();

function toGroup(chat: StoredChat): SprocketGroup {
  const members = sprocketChats.members(chat.id);
  const last = sprocketMessages.last(chat.id);
  const replying = members.find((m) => runningChat(m) === chat.id);
  return {
    id: chat.id,
    kind: "group",
    name: chat.name ?? "",
    members,
    ...(replying ? { replying } : {}),
    createdAt: chat.createdAt,
    running: !!replying,
    pending: suggestions.pendingIn(chat.id),
    ...(last ? { lastMessage: last } : {}),
  };
}

function getGroup(id: string): StoredChat {
  const chat = sprocketChats.get(id);
  if (chat?.kind !== "group") throw new ServiceError("Not found", 404);
  return chat;
}

/** A group from a request: a name, and two to four known Sprockets whose names @mentions can tell apart. */
function parseGroup(body: Partial<SprocketGroupInput> | undefined): SprocketGroupInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ServiceError("Give the group a name.", 400);
  if (name.length > MAX_NAME) throw new ServiceError(`Names can be at most ${MAX_NAME} characters.`, 400);
  const members = body?.members;
  if (!Array.isArray(members) || members.some((m) => typeof m !== "string")) throw new ServiceError("Members must be a list of Sprockets", 400);
  if (members.length < GROUP_MEMBERS_MIN) throw new ServiceError("A group has at least two Sprockets.", 400);
  if (members.length > GROUP_MEMBERS_MAX) throw new ServiceError("A group has at most four Sprockets.", 400);
  if (new Set(members).size !== members.length) throw new ServiceError("A Sprocket can be in a group once.", 400);
  const names = new Set<string>();
  for (const id of members) {
    const s = sprockets.get(id);
    if (!s) throw new ServiceError("Unknown Sprocket", 400);
    if (names.has(s.name.toLowerCase())) throw new ServiceError(`Two members are called ${s.name}, so @${s.name} would mean both. Rename one first.`, 400);
    names.add(s.name.toLowerCase());
  }
  return { name, members };
}

export function listGroups(): SprocketGroup[] {
  return sprocketChats.groups().map(toGroup);
}

export function createGroup(body: Partial<SprocketGroupInput> | undefined): SprocketGroup {
  const { name, members } = parseGroup(body);
  const group = toGroup(sprocketChats.createGroup(name, members));
  changed();
  return group;
}

/** Rename a group or change its members; the first is the lead. Turns waiting for a member who left are dropped. */
export function updateGroup(id: string, body: Partial<SprocketGroupInput> | undefined): SprocketGroup {
  getGroup(id);
  const { name, members } = parseGroup(body);
  sprocketChats.updateGroup(id, name, members);
  changed();
  return toGroup(getGroup(id));
}

/** Delete a group and its chat; its members stay. Suggestions still waiting there expire, as when it's cleared. */
export function deleteGroup(id: string): void {
  getGroup(id);
  rounds.delete(id);
  expireInChat(id);
  sprocketChats.removeGroup(id);
  changed();
}

/**
 * The renamed Sprocket `id` would share its new name with another member of one of its groups. @mentions couldn't
 * tell them apart, so renaming is refused (ADR 0022).
 */
export function nameClash(id: string, name: string): string | undefined {
  for (const g of sprocketChats.groups()) {
    const members = sprocketChats.members(g.id);
    if (!members.includes(id)) continue;
    const twin = members.find((m) => m !== id && sprockets.get(m)?.name.toLowerCase() === name.toLowerCase());
    if (twin) return `${name} is the name of another Sprocket in the group ${g.name}. Pick another.`;
  }
}

/**
 * Who `text` @mentions among `members`, in the order they're first mentioned: a name after `@`, whole (not the
 * start of a longer word) and in any case. Longer names are matched first, so "@Doc Keeper" isn't also "@Doc".
 */
export function mentioned(text: string, members: { id: string; name: string }[]): string[] {
  const lower = text.toLowerCase();
  const taken: [number, number][] = [];
  const found: { at: number; id: string }[] = [];
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const name = "@" + m.name.toLowerCase();
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) {
      const end = at + name.length;
      if (/[\p{L}\p{N}_]/u.test(text[end] ?? "") || taken.some(([s, e]) => at < e && end > s)) continue;
      taken.push([at, end]);
      found.push({ at, id: m.id });
      break;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

const membersOf = (chatId: string) => sprocketChats.members(chatId).flatMap((id) => (sprockets.get(id) ? [{ id, name: sprockets.get(id)!.name }] : []));

/**
 * The user wrote in a group: a new round, for the members they mention or else the lead. Turns still waiting from
 * the last round are dropped; a turn going now finishes first.
 */
export function startRound(chatId: string, text: string): void {
  const picked = mentioned(text, membersOf(chatId));
  rounds.set(chatId, { queue: picked.length ? picked : sprocketChats.members(chatId).slice(0, 1), turns: 0 });
  if (!active.has(chatId)) next(chatId);
}

/** Stop a group's round (its chat was cleared): the turn going now ends without passing on. */
export function endRound(chatId: string): void {
  rounds.delete(chatId);
}

/** Start the next turn of a group's round, if there's one and the round has turns left. */
function next(chatId: string): void {
  const round = rounds.get(chatId);
  if (!round) return;
  const members = sprocketChats.members(chatId);
  round.queue = round.queue.filter((id) => members.includes(id)); // members who left meanwhile
  const who = round.queue.shift();
  if (!who) return void rounds.delete(chatId);
  if (round.turns >= GROUP_TURNS_MAX) {
    rounds.delete(chatId);
    sprocketMessages.create(chatId, "notice", `Paused after ${GROUP_TURNS_MAX} replies in a row. Write to the group to go on.`, userMessageTime(chatId));
    changed();
    return;
  }
  round.turns++;
  active.set(chatId, { sprocketId: who, round });
  requestReply(chatId, who);
}

// A member's turn ended: the members its reply mentions get theirs (unless the user wrote meanwhile), then the next.
onTurnEnded((chatId: string, sprocketId: string, reply: SprocketMessage | undefined) => {
  const turn = active.get(chatId);
  if (turn?.sprocketId !== sprocketId) return; // its run in another chat, or not a group
  active.delete(chatId);
  if (reply && rounds.get(chatId) === turn.round) {
    const others = membersOf(chatId).filter((m) => m.id !== sprocketId);
    for (const id of mentioned(reply.text, others)) if (!turn.round.queue.includes(id)) turn.round.queue.push(id);
  }
  next(chatId);
});
