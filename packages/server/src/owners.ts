// Session ownership (ADR 0016): which files or folders each session in a project owns, as the user tells the
// project's Coordinator ("Claude owns src/engine"). The Coordinator routes requests by it, and an edit to files
// a session owns, by another session, wakes it like an overlap (overlaps.ts). Owners go when their panel closes.
// (Kept free of sprockets.ts, which imports the runs, so the capabilities can use it without a cycle.)
import { isAbsolute, normalize, relative } from "node:path";
import type { Panel, Project, ProjectOwner } from "@rails/shared";
import { onPanelForgotten } from "./bridge/index.ts";
import { owners, panels } from "./db.ts";
import { listeners } from "./util.ts";

/** Most paths one session can own. */
export const MAX_OWNED = 10;

const changes = listeners();
/** Owners changed (the hub tells browsers the Sprockets changed: they show on the Coordinator's panel). */
export const onOwnersChanged = changes.on;

/** A path inside the project, relative to it, without "./" or a trailing "/". Undefined when it isn't inside. */
export function ownedPath(project: Project, raw: string): string | undefined {
  const p = raw.trim();
  if (!p || /[\u0000-\u001f\u007f]/.test(p)) return undefined; // no line breaks or control characters
  const rel = normalize(isAbsolute(p) ? relative(project.path, p) : p).replace(/\/+$/, "");
  return !rel || rel === "." || rel.startsWith("..") || isAbsolute(rel) ? undefined : rel;
}

/** Record what a session owns, replacing what it owned before (an empty list clears it). */
export function setOwner(project: Project, panel: Panel, raw: string[]): string[] {
  const paths = [...new Set(raw.map((p) => ownedPath(project, p) ?? ""))];
  const bad = raw.filter((p) => !ownedPath(project, p));
  if (bad.length) throw new Error(`Paths must be inside the project, relative to it: ${bad.map((p) => JSON.stringify(p)).join(", ")}.`);
  if (paths.length > MAX_OWNED) throw new Error(`A session can own at most ${MAX_OWNED} paths.`);
  const taken = owners.list(project.id).filter((o) => o.panelId !== panel.id && paths.includes(o.path));
  if (taken.length) throw new Error(`Already owned by another session: ${taken.map((o) => o.path).join(", ")}. Change that session's first.`);
  owners.set(project.id, panel.id, paths);
  changes.emit();
  return paths;
}

/** A project's owners, a session per entry, in the order they were set. */
export function projectOwners(projectId: string): ProjectOwner[] {
  const by = new Map<string, string[]>();
  for (const o of owners.list(projectId)) by.set(o.panelId, [...(by.get(o.panelId) ?? []), o.path]);
  return [...by].flatMap(([panelId, paths]) => {
    const panel = panels.get(panelId);
    return panel ? [{ panelId, kind: panel.kind, title: panel.title, paths }] : [];
  });
}

/** Which session owns a file (relative to the project): the most specific owned path that covers it. */
export function ownerOf(projectId: string, file: string): string | undefined {
  let best: { panelId: string; path: string } | undefined;
  for (const o of owners.list(projectId))
    if ((file === o.path || file.startsWith(o.path + "/")) && (!best || o.path.length > best.path.length)) best = o;
  return best?.panelId;
}

/** The user (or the Coordinator) clears what a session owns. */
export function clearOwner(panelId: string): void {
  if (owners.clear(panelId)) changes.emit();
}

/** Owners go with their panel. */
export function startOwners(): void {
  onPanelForgotten((id) => clearOwner(id));
}
