// Team chats' rounds (ADR 0022, 0023): who is in a team, who a message asks something or gives a step, and who still
// has a turn coming. Rules only, read from the database; what members are told about them is prompt.ts.
import type { SprocketMessage } from "@rails/shared";
import { projects, sprocketChats, sprocketMessages, sprocketRuns, sprockets, type StoredChat, type StoredRun } from "./db.ts";

/** The questions in a chat that wait for the user's answer: who asked, and what (with its options). */
export function waitingAsks(chatId: string): { sprocketId: string; question: string; options: string[] }[] {
  return sprocketRuns.list(["waiting"], chatId).flatMap((r) => {
    const a = sprocketMessages.askOf(r.id)?.ask;
    return a ? [{ sprocketId: r.sprocketId, question: a.question, options: a.options }] : [];
  });
}

/** The team a run is in (ADR 0022): its name and members, as the members' instructions describe them. */
export type TeamInfo = { name: string; members: { id: string; name: string; lead: boolean; description: string; project?: string }[] };

export function teamInfo(chat: StoredChat): TeamInfo {
  const members = sprocketChats.members(chat.id).flatMap((id, i) => {
    const m = sprockets.get(id);
    return m ? [{ id, name: m.name, lead: i === 0, description: m.description, project: m.projectId ? projects.get(m.projectId)?.name : undefined }] : [];
  });
  return { name: chat.name ?? "", members };
}

/** The members whose turns are queued in a chat, in order. */
export const queuedIn = (chatId: string) => sprocketRuns.list(["queued"], chatId).map((q) => q.sprocketId);

/**
 * The teammates `text` asks something or gives something to do: a question with their name in it ("What do you
 * think, Fred?"), or a sentence that starts with it ("Fred, draft step 2.").
 */
export function askedTeammates(text: string, members: { name: string }[]): string[] {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim());
  return members
    .filter((m) => {
      const n = m.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const named = new RegExp(`(^|[^\\p{L}\\p{N}_])@?${n}(?![\\p{L}\\p{N}_])`, "iu");
      const first = new RegExp(`^[^\\p{L}\\p{N}@]*@?${n}\\s*[,:\u2013\u2014-]`, "iu");
      return sentences.some((s) => (s.endsWith("?") && named.test(s)) || first.test(s));
    })
    .map((m) => m.name);
}

/**
 * The teammates the message that gave this run the turn (its passer's last before the pass) asks something or
 * gives a step, apart from this member and the passer, who haven't written since: the turn should go on to them
 * ("Pam, draft it. Fred, check it after her." gives Pam the turn, then Fred's).
 */
export function handOn(history: SprocketMessage[], r: Pick<StoredRun, "from" | "sourceId" | "sprocketId">, team: TeamInfo): string[] {
  if (!r.from || !r.sourceId) return [];
  const at = history.findIndex((m) => m.id === r.sourceId);
  if (at < 0) return [];
  const by = history.slice(0, at).findLastIndex((m) => m.author === "sprocket" && m.sprocketId === r.from);
  if (by < 0) return [];
  const since = history.slice(by + 1);
  const others = team.members.filter((m) => m.id !== r.sprocketId && m.id !== r.from && !since.some((x) => x.author === "sprocket" && x.sprocketId === m.id));
  return askedTeammates(history[by].text, others);
}

/** A message for the whole team, without @everyone ("what do you all think?"). */
const FOR_ALL = /\b(everyone|everybody|all of you|each of you|you all|y'all|you guys|whole team|the team)\b|\bteam\s*[?!]/i;

/** A run that's part of answering the user's message (theirs, or a pass), not one an approval or a card started. */
export const inRound = (r: StoredRun) => r.trigger === "user" || r.trigger === "pass";

/** Thanks, greetings and goodbyes to the team, which one answer covers. */
const SMALL_TALK = /^\W*(thanks|thank you|thx|ty|cheers|great work|good job|nice work|well done|bye|goodbye|good night|night|hi|hello|hey|morning|good morning)\b/i;

/**
 * When the user's latest message asks the whole team (in words, not @everyone, which gives each a turn), the
 * other members who haven't written since: the turn should go round to them.
 */
export function notYet(history: SprocketMessage[], r: Pick<StoredRun, "sprocketId">, team: TeamInfo): string[] {
  const at = history.findLastIndex((m) => m.author === "user");
  const text = history[at]?.text ?? "";
  if (at < 0 || !FOR_ALL.test(text) || /@everyone\b/i.test(text) || SMALL_TALK.test(text)) return [];
  const since = history.slice(at + 1);
  return team.members.filter((m) => m.id !== r.sprocketId && !since.some((x) => x.author === "sprocket" && x.sprocketId === m.id)).map((m) => m.name);
}
