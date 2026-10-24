// A team's members (ADR 0022, 0033): who is in a team, and the questions waiting for the user. Read from the database;
// what members are told about them is prompt.ts.
import { projects, sprocketChats, sprocketMessages, sprocketRuns, sprockets, type StoredChat } from "../db.ts";

/** The questions in a chat that wait for the user's answer: who asked, and what (with its options). */
export function waitingAsks(chatId: string): { sprocketId: string; question: string; options: string[] }[] {
  return sprocketRuns.list(["waiting"], chatId).flatMap((r) => {
    const a = sprocketMessages.askOf(r.id)?.ask;
    return a ? [{ sprocketId: r.sprocketId, question: a.question, options: a.options }] : [];
  });
}

/** The team a run is in (ADR 0022): its name and members, as the members' instructions describe them. */
export type TeamInfo = { name: string; members: { id: string; name: string; description: string; project?: string }[] };

export function teamInfo(chat: StoredChat): TeamInfo {
  const members = sprocketChats.members(chat.id).flatMap((id) => {
    const m = sprockets.get(id);
    return m ? [{ id, name: m.name, description: m.description, project: m.projectId ? projects.get(m.projectId)?.name : undefined }] : [];
  });
  return { name: chat.name ?? "", members };
}
