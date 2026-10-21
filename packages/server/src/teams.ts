// Team chats (ADR 0022, 0023): the user and two to four Sprockets, the first the lead. The user's message goes to the
// members it @mentions (every member for @everyone); else, if it's a tapped option, to whoever asked; else to whom
// the decision model says it's for, if one is set (an answer to a waiting question goes to its asker that way);
// else to those whose questions wait for an answer; else the lead. Members pass the turn with pass_turn
// (harness/turns.ts), which runs.ts carries out. This decides who answers the user.
import type { ClassifierQuestion } from "@earendil-works/pi-ai";
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, findMentions, type SprocketTeam, type SprocketTeamInput } from "@rails/shared";
import { settings, sprocketChats, sprocketMessages, sprockets, suggestions, type StoredChat } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { findClassifier, models } from "./models.ts";
import { answerWaiting, cancelRuns, chatTurns, requestReply, waitingAsks } from "./runs.ts";
import { expireInChat } from "./suggestions.ts";
import { listeners } from "./util.ts";

const MAX_NAME = 40;

const teamChanges = listeners();
/** A team was made, edited or deleted. */
export const onTeamsChanged = teamChanges.on;
const changed = teamChanges.emit;

/** Teams whose latest user message is with the decision model (who answers it), by a number per message. */
const routing = new Map<string, number>();
let routes = 0;

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
    ...(routing.has(chat.id) ? { routing: true } : {}),
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
 * once; a turn going now finishes, but doesn't pass the turn on. When the decision model is asked who answers,
 * the turns are queued once it says (`routing` meanwhile).
 */
export function startRound(chatId: string, text: string, messageId?: string): void {
  const members = membersOf(chatId);
  const lead = members[0]?.id;
  cancelRuns(chatId);
  routing.delete(chatId);
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
  // Questions waiting for an answer: a tapped option goes to whoever asked it.
  const asks = waitingAsks(chatId).filter((a) => members.some((m) => m.id === a.sprocketId));
  const said = text.trim().toLowerCase();
  const tapped = [...new Set(asks.filter((a) => a.options.some((o) => o.trim().toLowerCase() === said)).map((a) => a.sprocketId))];
  if (tapped.length) {
    answerWaiting(chatId, text, tapped);
    return begin(tapped);
  }
  // Without the decision model, a typed message answers them all; with it, those it says it's for.
  const fallback = () => {
    const askers = answerWaiting(chatId, text).filter((id) => members.some((m) => m.id === id));
    return askers.length ? askers : lead ? [lead] : [];
  };
  const model = routingModel();
  if (!model) return begin(fallback());
  const n = ++routes;
  routing.set(chatId, n);
  changed();
  const open = asks.map((a) => ({ name: members.find((m) => m.id === a.sprocketId)!.name, question: a.question }));
  void byModel(model, chatId, text, members, messageId, open)
    .catch((e) => (console.error("teams: routing:", e), undefined))
    .then((judged) => {
      if (routing.get(chatId) !== n) return; // the user wrote again, or the chat was cleared
      routing.delete(chatId);
      if (!judged) return begin(fallback());
      answerWaiting(chatId, text, judged);
      begin(judged);
    });
}

/** The decision model, if the user picked one (Settings → Models): it says who a message without @ is for. */
export function routingModel() {
  const ref = settings.get("decisionModel");
  return ref ? findClassifier(ref) : undefined;
}

/** How long the decision model gets to say who answers; past it, the rules do. */
const ROUTE_MS = 6000;
/** Messages before the user's that it sees, and how much of each (their ends). */
const ROUTE_CONTEXT = 8;
const ROUTE_CHARS = 400;
const EVERYONE = /\b(everyone|everybody|all of you|each of you|you all|y'all|whole team)\b/i;

/** The messages before the user's latest (`messageId`), oldest first, as "Name: text". */
function before(chatId: string, members: Member[], messageId: string | undefined): string[] {
  const list = sprocketMessages.list(chatId).filter((m) => m.author === "user" || m.author === "sprocket");
  const end = messageId ? list.findIndex((m) => m.id === messageId) : list.length - 1;
  return list.slice(Math.max(0, (end < 0 ? list.length : end) - ROUTE_CONTEXT), end < 0 ? list.length : end).map((m) => {
    const who = m.author === "user" ? "User" : members.find((x) => x.id === m.sprocketId)?.name ?? "A former member";
    const text = m.text.length > ROUTE_CHARS ? "…" + m.text.slice(-ROUTE_CHARS) : m.text;
    return `${who}: ${text}`;
  });
}

/**
 * How sure the decision model must be that a member should answer. From a first evaluation on Jev: members a
 * message was for scored 0.77 and up; a member it was only near (named as the one to answer second, or whose area
 * it touched) 0.5 to 0.56. Below the bar for everyone, the likeliest answers.
 */
const ROUTE_BAR = 0.6;

/**
 * Who the decision model says the message is for: each member is a yes-or-no question, and those it's sure enough
 * of answer (in the team's order); if none, the likeliest. For a message that names no one.
 * Undefined when it fails or is slow.
 */
export async function byModel(
  model: NonNullable<ReturnType<typeof routingModel>>,
  chatId: string,
  text: string,
  members: Member[],
  messageId: string | undefined,
  open: { name: string; question: string }[] = [],
): Promise<string[] | undefined> {
  const questions: Record<string, ClassifierQuestion> = {};
  members.forEach((m, i) => {
    const lead = i === 0;
    questions[`member_${i}`] = {
      type: "bool",
      instructions: `This is a group chat between a user and a team of AI helpers. Should ${m.name}${lead ? " (the team's lead)" : ""} reply to the user's new message?`,
      criteria: {
        true: `The message speaks to everyone; or it speaks to ${m.name} by name ("${m.name}, …", "…, ${m.name}?"), even about another helper's area; or it answers or follows up on what ${m.name} said last (a question of theirs waiting for the user's answer, say); or it asks about ${m.name}'s area${lead ? "; or it's for the team in general (the lead takes those)" : ""}.`,
        false: `The message speaks to another helper by name; or it follows up on another helper's last message, or asks about another helper's area${lead ? "" : "; or it's for the team in general (the lead takes those)"}.`,
      },
    };
  });
  const state = {
    team: members.map((m, i) => `${m.name}${i === 0 ? " (lead)" : ""}${m.description ? `: ${m.description.split("\n")[0].slice(0, 160)}` : ""}`),
    earlier_messages: before(chatId, members, messageId),
    ...(open.length ? { questions_waiting_for_the_users_answer: open.map((q) => `${q.name}: ${q.question}`) } : {}),
    new_message_from_user: text.length > ROUTE_CHARS * 2 ? text.slice(0, ROUTE_CHARS * 2) + "…" : text,
  };
  const result = await models.classify(model, { state, questions }, { signal: AbortSignal.timeout(ROUTE_MS) });
  if (result.stopReason !== "stop") return undefined;
  const p = members.map((m, i) => {
    const a = result.answers[`member_${i}`];
    return { id: m.id, name: m.name, p: a?.type === "bool" ? a.probability : 0 };
  });
  const yes = p.filter((x) => x.p >= ROUTE_BAR).sort((a, b) => b.p - a.p);
  if (!yes.length) return p.some((x) => x.p > 0) ? [p.reduce((a, b) => (b.p > a.p ? b : a)).id] : undefined;
  // Several answer only when the message speaks to everyone. Otherwise two members whose roles both fit ("what's
  // one risk?") would say the same thing: the likeliest answers.
  const several = EVERYONE.test(text) || yes.length === members.length;
  // In the team's order, the lead first.
  return several ? members.filter((m) => yes.some((y) => y.id === m.id)).map((m) => m.id) : [yes[0].id];
}

/** Stop a team's turns (its chat was cleared, or it's deleted): queued ones and questions waiting are dropped. */
export function endRound(chatId: string): void {
  cancelRuns(chatId, { waiting: true });
  routing.delete(chatId);
}
