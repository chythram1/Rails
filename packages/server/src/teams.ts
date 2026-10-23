// Team chats (ADR 0022, 0023): the user and two to four Sprockets, the first the lead. The user's message goes to the
// members it @mentions (every member for @everyone); else, if it's a tapped option, to whoever asked; else to those
// whose questions wait for an answer; else the lead. No model guesses who it's for (ADR 0023): the lead passes on. Members pass the turn with pass_turn
// (harness/turns.ts), which runs.ts carries out. This decides who answers the user.
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, findMentions, type SprocketTeam, type SprocketTeamInput } from "@rails/shared";
import { sprocketChats, sprocketMessages, sprockets, suggestions, type StoredChat } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { answerWaiting, cancelRuns, chatTurns, requestReply, waitingAsks } from "./runs.ts";
import { expireInChat } from "./suggestions.ts";
import { listeners } from "./util.ts";

const MAX_NAME = 40;

const teamChanges = listeners();
/** A team was made, edited or deleted. */
export const onTeamsChanged = teamChanges.on;
const changed = teamChanges.emit;


function toTeam(chat: StoredChat): SprocketTeam {
  const members = sprocketChats.members(chat.id);
  const last = sprocketMessages.last(chat.id);
  const turns = chatTurns(chat.id);
  const replying = turns.replying;
  const waiting = turns.queued.filter((m) => members.includes(m));
  return {
    id: chat.id,
    kind: "team",
    name: chat.name ?? "",
    members,
    ...(replying ? { replying } : {}),
    waiting,
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
  endRound(id);
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
 * Who `text` @mentions among `members`, in the order they're first mentioned (findMentions: a whole name, or the
 * start of just one member's name, as in "@Doc").
 */
export function mentioned(text: string, members: { id: string; name: string }[]): string[] {
  return [...new Set(findMentions(text, members.map((m) => m.name)).map((f) => members[f.member].id))];
}

type Member = { id: string; name: string; description: string };
const membersOf = (chatId: string): Member[] =>
  sprocketChats.members(chatId).flatMap((id) => {
    const s = sprockets.get(id);
    return s ? [{ id, name: s.name, description: s.description }] : [];
  });

/** `@everyone` asks every member (ADR 0023). */
const EVERYONE_TAG = /(^|[^\p{L}\p{N}_])@everyone(?![\p{L}\p{N}_])/iu;

/**
 * The user wrote in a team: the members it's for get turns, in order. Turns still queued from before are dropped at
 * once; a turn going now finishes, but doesn't pass the turn on.
 */
export function startRound(chatId: string, text: string, messageId?: string): void {
  const members = membersOf(chatId);
  const lead = members[0]?.id;
  cancelRuns(chatId);
  const begin = (picked: string[]) => {
    for (const who of picked) requestReply(chatId, who, { trigger: "user", sourceId: messageId });
    changed();
  };
  // Those it @mentions, in the order it does (every member for @everyone). It answers their questions too.
  const picked = EVERYONE_TAG.test(text) ? members.map((m) => m.id) : mentioned(text, members);
  if (picked.length) {
    answerWaiting(chatId, text, picked);
    return begin(picked);
  }
  // Questions waiting for an answer: a tapped option goes to whoever asked it, a typed message to everyone who asked.
  const asks = waitingAsks(chatId).filter((a) => members.some((m) => m.id === a.sprocketId));
  const said = text.trim().toLowerCase();
  const tapped = [...new Set(asks.filter((a) => a.options.some((o) => o.trim().toLowerCase() === said)).map((a) => a.sprocketId))];
  if (tapped.length) {
    answerWaiting(chatId, text, tapped);
    return begin(tapped);
  }
  const askers = answerWaiting(chatId, text).filter((id) => members.some((m) => m.id === id));
  begin(askers.length ? askers : lead ? [lead] : []);
}

/** Stop a team's turns (its chat was cleared, or it's deleted): queued ones and questions waiting are dropped. */
export function endRound(chatId: string): void {
  cancelRuns(chatId, { waiting: true });
}
