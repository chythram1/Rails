// A session's title as the user sees it (the tab, the sidebar, the board): its own title when discovery knows
// it, else its panel's. Only the database and discovery below it, so any service can use it without an import
// cycle (handoffs.ts, watches.ts, overlaps.ts, decisions.ts).
import type { Panel } from "@rails/shared";
import { projects } from "./db.ts";
import { sessionsFor } from "./providers/index.ts";

export async function sessionTitle(panel: Panel): Promise<string> {
  const project = projects.get(panel.projectId);
  if (!project || !panel.sessionId) return panel.title;
  const found = await sessionsFor(project.path).catch(() => []);
  return found.find((s) => s.id === panel.sessionId)?.title || panel.title;
}
