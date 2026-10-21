// Team chats (ADR 0022): the user and two to four Sprockets, the first the lead. The user's message goes to the
// members it @mentions; without a mention, to those it's for (the decision model judges, or Rails' rules), else the
// lead. A reply that @mentions others passes the turn to them. Only the user starts a round, and a round stops after
// TEAM_TURNS_MAX turns, so Sprockets can't keep replying to each other. Runs themselves are runs.ts's: this decides
// whose turn it is.
import type { ClassifierQuestion } from "@earendil-works/pi-ai";
import { TEAM_MEMBERS_MAX, TEAM_MEMBERS_MIN, TEAM_TURNS_MAX, findMentions, type SprocketTeam, type SprocketTeamInput, type SprocketMessage } from "@rails/shared";
import { settings, sprocketChats, sprocketMessages, sprockets, suggestions, type StoredChat } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { findClassifier, models } from "./models.ts";
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
/** Teams whose latest user message is with the decision model (who answers it), by a number per message. */
const routing = new Map<string, number>();
let routes = 0;

function toTeam(chat: StoredChat): SprocketTeam {
  const members = sprocketChats.members(chat.id);
  const last = sprocketMessages.last(chat.id);
  const replying = members.find((m) => runningChat(m) === chat.id);
  // Whose turns are coming: the member whose turn it is, until its run starts (it may be busy in another chat), then the queue.
  const turn = active.get(chat.id)?.sprocketId;
  const waiting = [...(turn && turn !== replying ? [turn] : []), ...(rounds.get(chat.id)?.queue ?? [])].filter((m) => members.includes(m));
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

/**
 * The user wrote in a team: a new round, for the members the message is for (`addressees`). Turns still waiting
 * from the last round are dropped at once; a turn going now finishes first. When the decision model is asked who
 * answers, the round starts once it says (`routing` meanwhile).
 */
export function startRound(chatId: string, text: string, messageId?: string): void {
  const members = membersOf(chatId);
  const lead = members[0]?.id;
  const begin = (picked: string[]) => {
    rounds.set(chatId, { queue: leadFirst(picked.length ? picked : lead ? [lead] : [], lead), turns: 0 });
    if (!active.has(chatId)) next(chatId);
    changed();
  };
  rounds.delete(chatId);
  const picked = mentioned(text, members);
  const model = routingModel();
  if (!model) {
    routing.delete(chatId);
    return begin(picked.length ? picked : byRules(chatId, text, members, messageId));
  }
  // Those it @mentions answer; the model may add others it's clearly for too ("@Doc and Scout, …").
  const n = ++routes;
  routing.set(chatId, n);
  changed();
  void byModel(model, chatId, text, members, messageId, !picked.length)
    .catch((e) => (console.error("teams: routing:", e), undefined))
    .then((judged) => {
      if (routing.get(chatId) !== n) return; // the user wrote again, or the chat was cleared
      routing.delete(chatId);
      if (picked.length) begin([...new Set([...picked, ...byNaming(text, members.filter((m) => judged?.includes(m.id) && !picked.includes(m.id)))])]);
      else begin(judged ?? byRules(chatId, text, members, messageId));
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
 * of answer (in the order the message names them, else the team's); if none, the likeliest (with `likeliest`).
 * Undefined when it fails or is slow.
 */
export async function byModel(
  model: NonNullable<ReturnType<typeof routingModel>>,
  chatId: string,
  text: string,
  members: Member[],
  messageId: string | undefined,
  likeliest = true,
): Promise<string[] | undefined> {
  const questions: Record<string, ClassifierQuestion> = {};
  members.forEach((m, i) => {
    const lead = i === 0;
    questions[`member_${i}`] = {
      type: "bool",
      instructions: `This is a group chat between a user and a team of AI helpers. Should ${m.name}${lead ? " (the team's lead)" : ""} reply to the user's new message?`,
      criteria: {
        true: `The message names ${m.name} or speaks to everyone; or it answers or follows up on what ${m.name} said last; or it asks about ${m.name}'s area and names no one else${lead ? "; or it's for the team in general and doesn't name anyone (the lead takes those)" : ""}.`,
        false: `The message is for someone else: it names another helper, or follows up on another helper's last message${lead ? "" : "; or it's for the team in general and doesn't name anyone (the lead takes those)"}.`,
      },
    };
  });
  const state = {
    team: members.map((m, i) => `${m.name}${i === 0 ? " (lead)" : ""}${m.description ? `: ${m.description.split("\n")[0].slice(0, 160)}` : ""}`),
    earlier_messages: before(chatId, members, messageId),
    new_message_from_user: text.length > ROUTE_CHARS * 2 ? text.slice(0, ROUTE_CHARS * 2) + "…" : text,
  };
  const result = await models.classify(model, { state, questions }, { signal: AbortSignal.timeout(ROUTE_MS) });
  if (result.stopReason !== "stop") return undefined;
  const p = members.map((m, i) => {
    const a = result.answers[`member_${i}`];
    return { id: m.id, name: m.name, p: a?.type === "bool" ? a.probability : 0 };
  });
  const yes = p.filter((x) => x.p >= ROUTE_BAR).sort((a, b) => b.p - a.p);
  if (!yes.length) return !likeliest ? [] : p.some((x) => x.p > 0) ? [p.reduce((a, b) => (b.p > a.p ? b : a)).id] : undefined;
  // Several answer only when the message asks several: it names them, or speaks to everyone. Otherwise two members
  // whose roles both fit ("what's one risk?") would say the same thing: the likeliest answers.
  const several = members.filter((m) => namedAt(text, m.name) >= 0).length > 1 || EVERYONE.test(text) || yes.length === members.length;
  // In the order the message names them, else the team's (the lead first).
  return byNaming(text, several ? members.filter((m) => yes.some((y) => y.id === m.id)) : yes.slice(0, 1));
}

/** `picked` in the order `text` names them (those it doesn't name keep theirs, after). */
function byNaming(text: string, picked: { id: string; name: string }[]): string[] {
  const at = (name: string) => {
    const i = namedAt(text, name);
    return i < 0 ? Infinity : i;
  };
  return [...picked].sort((a, b) => at(a.name) - at(b.name)).map((m) => m.id);
}

/** Where `text` names `name` as a whole word (any case), or -1. */
function namedAt(text: string, name: string): number {
  const lower = text.toLowerCase();
  const n = name.toLowerCase();
  for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, i + 1)) {
    if (!/[\p{L}\p{N}_]/u.test(text[i - 1] ?? "") && !/[\p{L}\p{N}_]/u.test(text[i + n.length] ?? "")) return i;
  }
  return -1;
}

/**
 * Who a message without @ is for, by Rails' rules (no decision model, or it failed): the members it names, everyone
 * when it says so, the member who asked the user something in the last reply, else the lead.
 */
export function byRules(chatId: string, text: string, members: Member[], messageId?: string): string[] {
  const named = members.filter((m) => namedAt(text, m.name) >= 0);
  if (named.length) return byNaming(text, named);
  if (EVERYONE.test(text)) return members.map((m) => m.id);
  const list = sprocketMessages.list(chatId).filter((m) => m.author === "user" || m.author === "sprocket");
  const end = messageId ? list.findIndex((m) => m.id === messageId) : -1;
  const last = (end >= 0 ? list.slice(0, end) : list.slice(0, -1)).at(-1);
  if (last?.author === "sprocket" && /\?\s*$/.test(last.text) && members.some((m) => m.id === last.sprocketId)) return [last.sprocketId];
  return members[0] ? [members[0].id] : [];
}

/** The lead goes ahead of everyone waiting (ADR 0022): it answers first when it's mentioned with others. */
const leadFirst = (queue: string[], lead: string | undefined) => (lead && queue.includes(lead) ? [lead, ...queue.filter((m) => m !== lead)] : queue);

/** Stop a team's round (its chat was cleared): the turn going now ends without passing on. */
export function endRound(chatId: string): void {
  rounds.delete(chatId);
  routing.delete(chatId);
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

/**
 * The members a reply asks something by name without an @, as people do in a chat: a question that starts or ends
 * with the name ("Pixel, what would you ship?", "Agreed, Scout?"). Models often write that rather than @Pixel.
 */
export function askedByName(text: string, members: { id: string; name: string }[]): string[] {
  const found: { at: number; id: string }[] = [];
  for (const sentence of text.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const q = sentence[0].trim();
    if (!q.endsWith("?")) continue;
    for (const m of members) {
      const n = m.name.toLowerCase();
      const lower = q.toLowerCase();
      const opens = lower.startsWith(n) && /^[,:]/.test(q.slice(n.length));
      const closes = lower.endsWith(`, ${n}?`);
      if ((opens || closes) && !found.some((f) => f.id === m.id)) found.push({ at: sentence.index!, id: m.id });
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.id);
}

// A member's turn ended: the members its reply @mentions or asks by name get theirs (unless the user wrote
// meanwhile), then the next turn. Members are told to @mention whoever they want an answer from, so a reply
// that names no one ends the round; the decision model isn't asked (it's optional, ADR 0022).
onTurnEnded((chatId: string, sprocketId: string, reply: SprocketMessage | undefined) => {
  const turn = active.get(chatId);
  if (turn?.sprocketId !== sprocketId) return; // its run in another chat, or not a team
  active.delete(chatId);
  const { round } = turn;
  if (reply && rounds.get(chatId) === round) {
    const others = membersOf(chatId).filter((m) => m.id !== sprocketId);
    for (const id of [...mentioned(reply.text, others), ...askedByName(reply.text, others)]) if (!round.queue.includes(id)) round.queue.push(id);
    round.queue = leadFirst(round.queue, sprocketChats.members(chatId)[0]);
  }
  next(chatId);
});
