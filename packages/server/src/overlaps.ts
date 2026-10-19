// Overlaps (ADR 0014): two live sessions in a project changing the same file within OVERLAP_MS of each other.
// They may be working against each other, and neither agent can see the other. Rails:
// - marks both sessions' tabs, in every project (panels.overlaps);
// - wakes the project's Coordinator for the session that changed the file second, so it can judge whether it
//   matters and draft a heads-up for that session, which the user sends. A session's edits within BATCH_MS
//   go in one wake, and a pair of sessions wakes it once per file per OVERLAP_MS.
// Only edits the agents report count (their edit tools, Codex's file changes), not files that shell commands
// change.
import type { PanelOverlap, SprocketEvent } from "@rails/shared";
import { OVERLAP_MS, rel, sharedFiles } from "./bridge/board.ts";
import { cardOf, onEvents, onPanelForgotten } from "./bridge/index.ts";
import { panels, projects, sprockets } from "./db.ts";
import { postEvent } from "./sprockets.ts";
import { listeners } from "./util.ts";
import { sessionTitle } from "./watches.ts";

/** How long a session's burst of edits is gathered into one wake. */
export const BATCH_MS = 15_000;
/** Most files an event names per other session. */
const MAX_FILES = 10;

type Others = { panelId: string; files: string[] }[];

/** Overlap wakes waiting for their batch to close, per session, and which ones were already reported. */
export class OverlapWakes {
  private pending = new Map<string, { others: Map<string, Set<string>>; timer: ReturnType<typeof setTimeout> }>();
  /** When each pair of sessions was last reported for a file. */
  private reported = new Map<string, number>();

  constructor(private fire: (panelId: string, others: Others) => void) {}

  /** `panelId` just changed `file`, which `otherPanelId` changed shortly before. */
  add(panelId: string, otherPanelId: string, file: string): void {
    const now = Date.now();
    const key = `${[panelId, otherPanelId].sort().join(" ")} ${file}`;
    if (now - (this.reported.get(key) ?? -Infinity) < OVERLAP_MS) return;
    if (this.reported.size > 1000) for (const [k, at] of this.reported) if (now - at >= OVERLAP_MS) this.reported.delete(k);
    this.reported.set(key, now);
    let p = this.pending.get(panelId);
    if (!p) {
      const timer = setTimeout(() => this.flush(panelId), BATCH_MS);
      timer.unref?.();
      p = { others: new Map(), timer };
      this.pending.set(panelId, p);
    }
    p.others.set(otherPanelId, (p.others.get(otherPanelId) ?? new Set()).add(file));
  }

  private flush(panelId: string) {
    const p = this.pending.get(panelId);
    this.pending.delete(panelId);
    if (p?.others.size) this.fire(panelId, [...p.others].map(([id, files]) => ({ panelId: id, files: [...files] })));
  }

  /** The panel closed. */
  forget(panelId: string): void {
    clearTimeout(this.pending.get(panelId)?.timer);
    this.pending.delete(panelId);
    for (const p of this.pending.values()) p.others.delete(panelId);
    for (const key of this.reported.keys()) if (key.split(" ", 2).includes(panelId)) this.reported.delete(key);
  }
}

// ---- the tabs' marks ----

const current = new Map<string, PanelOverlap[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const changes = listeners<[list: PanelOverlap[]]>();
/** The overlaps changed (any project). */
export const onOverlaps = changes.on;
export const overlapList = (): PanelOverlap[] => [...current.values()].flat();

/** Work out a project's overlaps again, and when to next: as the earliest change in one leaves the window. */
function refresh(projectId: string): ReturnType<typeof sharedFiles> {
  const project = projects.get(projectId);
  const now = Date.now();
  const shared = project ? sharedFiles(panels.list(projectId).filter((p) => p.kind !== "shell").map(cardOf), now) : [];
  const pairs = new Map<string, PanelOverlap>();
  for (const { file, by } of shared)
    for (const a of by)
      for (const b of by) {
        if (a.panelId === b.panelId) continue;
        const key = `${a.panelId} ${b.panelId}`;
        const o = pairs.get(key) ?? { panelId: a.panelId, otherPanelId: b.panelId, files: [] };
        o.files.push(rel(project!.path, file));
        pairs.set(key, o);
      }
  const list = [...pairs.values()];
  if (JSON.stringify(list) !== JSON.stringify(current.get(projectId) ?? [])) {
    if (list.length) current.set(projectId, list);
    else current.delete(projectId);
    changes.emit(overlapList());
  }
  clearTimeout(timers.get(projectId));
  timers.delete(projectId);
  const next = Math.min(...shared.flatMap((s) => s.by.map((e) => Date.parse(e.at) + OVERLAP_MS)));
  if (Number.isFinite(next)) {
    const timer = setTimeout(() => refresh(projectId), Math.max(1_000, next - now + 1_000));
    timer.unref?.();
    timers.set(projectId, timer);
  }
  return shared;
}

// ---- waking the Coordinator ----

/** Tell a project's Coordinator that a session changed files others changed shortly before. */
async function wakeCoordinator(panelId: string, others: Others): Promise<void> {
  const panel = panels.get(panelId);
  const project = panel && projects.get(panel.projectId);
  const coordinator = panel && sprockets.coordinatorOf(panel.projectId);
  if (!panel || !project || !coordinator) return;
  const open = others.flatMap((o) => {
    const p = panels.get(o.panelId);
    return p ? [{ panel: p, files: o.files.slice(0, MAX_FILES).map((f) => rel(project.path, f)) }] : [];
  });
  if (!open.length) return;
  const [title, ...titles] = await Promise.all([sessionTitle(panel), ...open.map((o) => sessionTitle(o.panel))]);
  const event: SprocketEvent = {
    panelId,
    kind: panel.kind,
    title,
    ...(panel.sessionId ? { sessionId: panel.sessionId } : {}),
    what: "overlap",
    overlaps: open.map((o, i) => ({
      panelId: o.panel.id,
      kind: o.panel.kind,
      title: titles[i],
      ...(o.panel.sessionId ? { sessionId: o.panel.sessionId } : {}),
      files: o.files,
    })),
  };
  const text = event.overlaps!.map((o) => `${o.files.join(", ")} (also changed by "${o.title}")`).join("\n");
  // Still this project's Coordinator (the lookups took a moment)?
  const now = sprockets.get(coordinator.id);
  if (now?.coordinator && now.projectId === panel.projectId) postEvent(coordinator.id, event, text);
}

/** Follow every session's edits. */
export function startOverlaps(): void {
  const wakes = new OverlapWakes((panelId, others) => void wakeCoordinator(panelId, others).catch((e) => console.error("overlaps:", e)));
  for (const p of projects.list()) refresh(p.id);
  onEvents((panel, events) => {
    try {
      const edited = new Set(events.flatMap((e) => (e.kind === "tool" && e.edit ? e.files : [])));
      if (!edited.size && !events.some((e) => e.kind === "ended")) return;
      const shared = refresh(panel.projectId);
      if (!edited.size || !sprockets.coordinatorOf(panel.projectId)) return;
      for (const { file, by } of shared) {
        if (!edited.has(file) || !by.some((e) => e.panelId === panel.id)) continue;
        for (const other of by) if (other.panelId !== panel.id) wakes.add(panel.id, other.panelId, file);
      }
    } catch (e) {
      console.error("overlaps:", e);
    }
  });
  onPanelForgotten((id) => {
    wakes.forget(id);
    for (const [projectId, list] of current) if (list.some((o) => o.panelId === id)) refresh(projectId);
  });
}
