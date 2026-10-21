// Session names: a short name the user gives a session in Rails, shown instead of the agent's own title everywhere
// Rails shows one (tabs, the sidebar, the Coordinator, agent tools), because agents title sessions with long or
// changing text. Rails keeps it in its database, by session, and never writes it into the agent's transcript.
import { parseSessionKey, SESSION_NAME_MAX, type SessionKey } from "@rails/shared";
import { panels, sessionNames } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { panelsChanged } from "./panels.ts";
import { listProjectSessions } from "./projects.ts";
import { sessionTitle } from "./titles.ts";

/**
 * Name a session of the project (`key` from the session list), or clear its name with an empty one. Names are one
 * line of at most SESSION_NAME_MAX characters, and no other session in the project may show the same title (in any
 * case), so "ui" means one session to the user and to agents.
 */
export async function nameSession(projectId: string, key: SessionKey, name: unknown): Promise<{ title: string }> {
  if (typeof name !== "string") throw new ServiceError("Give a name, or an empty one to clear it.", 400);
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length > SESSION_NAME_MAX) throw new ServiceError(`A name has at most ${SESSION_NAME_MAX} characters.`, 400);
  const { provider, id } = parseSessionKey(key);
  const listed = await listProjectSessions(projectId);
  // A session open in a panel whose agent hasn't written its transcript yet isn't listed.
  const open = panels.list(projectId).find((p) => p.kind === provider && p.sessionId === id);
  const session = listed.find((s) => s.key === key);
  if (!session && !open) throw new ServiceError("That session isn't in this project.", 404);

  if (clean) {
    const others = [
      ...listed.filter((s) => s.key !== key).map((s) => s.title),
      ...(await Promise.all(panels.list(projectId).filter((p) => p !== open && p.kind !== "shell" && !listed.some((s) => s.id === p.sessionId)).map(sessionTitle))),
    ];
    const taken = others.find((t) => t.trim().toLowerCase() === clean.toLowerCase());
    if (taken) throw new ServiceError(`Another session here is called “${taken}”.`, 409);
    sessionNames.set(provider, id, clean);
  } else sessionNames.clear(provider, id);

  panelsChanged(projectId);
  const title = clean || session?.agentTitle || session?.title || (open ? await sessionTitle(open) : "");
  return { title };
}
