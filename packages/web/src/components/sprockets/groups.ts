import type { Project, Sprocket } from "@rails/shared";

/** A heading's worth of Sprockets: a project's, or the unattached ones ("General"). */
export interface Group {
  key: string;
  title: string;
  list: Sprocket[];
}

const GENERAL = "general";
export const lastActive = (s: Sprocket) => s.lastMessage?.createdAt ?? s.createdAt;

/**
 * Sprockets by project, in the sidebar's order, then General (unattached). In each, the Coordinator first,
 * then the most recently active. `filter` keeps one group ("all" keeps them all); empty groups are left out.
 */
export function groupSprockets(list: Sprocket[], projects: Project[], filter = "all"): Group[] {
  const known = new Set(projects.map((p) => p.id));
  const groups: Group[] = [
    ...projects.map((p) => ({ key: p.id, title: p.name, list: list.filter((s) => s.projectId === p.id) })),
    { key: GENERAL, title: "General", list: list.filter((s) => !s.projectId || !known.has(s.projectId)) },
  ];
  for (const g of groups) g.list.sort((a, b) => Number(b.coordinator) - Number(a.coordinator) || lastActive(b).localeCompare(lastActive(a)));
  return groups.filter((g) => g.list.length && (filter === "all" || g.key === filter));
}
