// Team chats (ADR 0022): the user and two to four Sprockets, the first the lead. The user's message goes to the
// lead unless it @mentions members; a reply that @mentions others passes the turn to them. Only the user starts a
// round, and a round stops after TEAM_TURNS_MAX turns, so Sprockets can't keep replying to each other. Runs
// themselves are runs.ts's: this decides whose turn it is.
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, TEAM_TURNS_MAX, type SprocketTeam, type SprocketTeamInput, type SprocketMessage } from "@rails/shared";
import { sprocketChats, sprocketMessages, sprockets, suggestions, type StoredChat } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { onTurnEnded, requestReply, runningChat, userMessageTime } from "./runs.ts";
import { expireInChat } from "./suggestions.ts";
import { listeners } from "./util.ts";

const MAX_NAME = 40;

const teamChanges = listeners();
/** A team was made, edited or deleted. */
export const onTeamsChanged = teamChanges.on;
const changed = teamChanges.emit;

/** The turns still to come after the user's latest message in a team, and how many were taken. */
type Round = { queue: string[]; turns: number };
const rounds = new Map<string, Round>();
/** The member whose turn is going in each team, and the round it belongs to. */
const active = new Map<string, { sprocketId: string; round: Round }>();

function toTeam(chat: StoredChat): SprocketTeam {
  const members = sprocketChats.members(chat.id);
  const last = sprocketMessages.last(chat.id);
  const replying = members.find((m) => runningChat(m) === chat.id);
  return {
    id: chat.id,
    kind: "team",
    name: chat.name ?? "",
    members,
    ...(replying ? { replying } : {}),
    createdAt: chat.createdAt,
    running: !!replying,
    pending: suggestions.pendingIn(chat.id),
    ...(last ? { lastMessage: last } : {}),
  };
}

function getTeam(id: string): StoredChat {
  const chat = sprocketChats.get(id);
  if (chat?.kind !== "team") throw new ServiceError("Not found", 404);
  return chat;
}

/** A team from a request: a name, and two to four known Sprockets whose names @mentions can tell apart. */
function parseTeam(body: Partial<SprocketTeamInput> | undefined): SprocketTeamInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ServiceError("Give the team a name.", 400);
  if (name.length > MAX_NAME) throw new ServiceError(`Names can be at most ${MAX_NAME} characters.`, 400);
  const members = body?.members;
  if (!Array.isArray(members) || members.some((m) => typeof m !== "string")) throw new ServiceError("Members must be a list of Sprockets", 400);
  if (members.length < TEAM_MEMBERS_MIN) throw new ServiceError("A team has at least two Sprockets.", 400);
  if (members.length > TEAM_MEMBERS_MAX) throw new ServiceError("A team has at most four Sprockets.", 400);
  if (new Set(members).size !== members.length) throw new ServiceError("A Sprocket can be in a team once.", 400);
  const names = new Set<string>();
  for (const id of members) {
    const s = sprockets.get(id);
    if (!s) throw new ServiceError("Unknown Sprocket", 400);
    if (names.has(s.name.toLowerCase())) throw new ServiceError(`Two members are called ${s.name}, so @${s.name} would mean both. Rename one first.`, 400);
    names.add(s.name.toLowerCase());
  }
  return { name, members };
}

export function listTeams(): SprocketTeam[] {
  return sprocketChats.teams().map(toTeam);
}

export function createTeam(body: Partial<SprocketTeamInput> | undefined): SprocketTeam {
  const { name, members } = parseTeam(body);
  const team = toTeam(sprocketChats.createTeam(name, members));
  changed();
  return team;
}

/** Rename a team or change its members; the first is the lead. Turns waiting for a member who left are dropped. */
export function updateTeam(id: string, body: Partial<SprocketTeamInput> | undefined): SprocketTeam {
  getTeam(id);
  const { name, members } = parseTeam(body);
  sprocketChats.updateTeam(id, name, members);
  changed();
  return toTeam(getTeam(id));
}

/** Delete a team and its chat; its members stay. Suggestions still waiting there expire, as when it's cleared. */
export function deleteTeam(id: string): void {
  getTeam(id);
  rounds.delete(id);
  expireInChat(id);
  sprocketChats.removeTeam(id);
  changed();
}

/**
 * The renamed Sprocket `id` would share its new name with another member of one of its teams. @mentions couldn't
 * tell them apart, so renaming is refused (ADR 0022).
 */
export function nameClash(id: string, name: string): string | undefined {
  for (const g of sprocketChats.teams()) {
    const members = sprocketChats.members(g.id);
    if (!members.includes(id)) continue;
    const twin = members.find((m) => m !== id && sprockets.get(m)?.name.toLowerCase() === name.toLowerCase());
    if (twin) return `${name} is the name of another Sprocket in the team ${g.name}. Pick another.`;
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
 * The user wrote in a team: a new round, for the members they mention or else the lead. Turns still waiting from
 * the last round are dropped; a turn going now finishes first.
 */
export function startRound(chatId: string, text: string): void {
  const picked = mentioned(text, membersOf(chatId));
  rounds.set(chatId, { queue: picked.length ? picked : sprocketChats.members(chatId).slice(0, 1), turns: 0 });
  if (!active.has(chatId)) next(chatId);
}

/** Stop a team's round (its chat was cleared): the turn going now ends without passing on. */
export function endRound(chatId: string): void {
  rounds.delete(chatId);
}

/** Start the next turn of a team's round, if there's one and the round has turns left. */
function next(chatId: string): void {
  const round = rounds.get(chatId);
  if (!round) return;
  const members = sprocketChats.members(chatId);
  round.queue = round.queue.filter((id) => members.includes(id)); // members who left meanwhile
  const who = round.queue.shift();
  if (!who) return void rounds.delete(chatId);
  if (round.turns >= TEAM_TURNS_MAX) {
    rounds.delete(chatId);
    sprocketMessages.create(chatId, "notice", `Paused after ${TEAM_TURNS_MAX} replies in a row. Write to the team to go on.`, userMessageTime(chatId));
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
  if (turn?.sprocketId !== sprocketId) return; // its run in another chat, or not a team
  active.delete(chatId);
  if (reply && rounds.get(chatId) === turn.round) {
    const others = membersOf(chatId).filter((m) => m.id !== sprocketId);
    for (const id of mentioned(reply.text, others)) if (!turn.round.queue.includes(id)) turn.round.queue.push(id);
  }
  next(chatId);
});
