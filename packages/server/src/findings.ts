// Findings (ADR 0029): a session ends its turn with a reply that names work in another session's files ("audio.js
// listens for shot/hit, but the game emits projectile:*"), and doesn't tell that session. Nothing woke anyone for
// that: a turn end wakes the Coordinator only when it asks the user something, and the agent may not use its
// message tool (Codex has none). Test runs 4 and 7 lost findings this way. Rails' rule, plain code that needs no
// decision model:
// - the reply (its turn_end) doesn't ask the user anything (looksLikeQuestion; those wake it already);
// - a sentence of it names a file that another live session owns (owners.ts) or changed in the last OVERLAP_MS,
//   and says something is wrong or needed there (CUE);
// - not files the reporting session changed itself lately (an overlap covers those, ADR 0014), not a session it
//   already wrote to lately (ADR 0018) or has a handoff planned to (ADR 0015), and once per pair and file per
//   OVERLAP_MS.
// Then the Coordinator wakes with a finding event: it drafts a message for that session, or replies (quiet).
// The decision model, when one is set, judges each turn end the same way in shadow (decisions.ts), to tune this.
import { basename } from "node:path";
import type { Panel, SprocketEvent } from "@rails/shared";
import { OVERLAP_MS, rel } from "./bridge/board.ts";
import { cardOf, onEvents, onPanelForgotten } from "./bridge/index.ts";
import type { SessionEvent } from "./bridge/events.ts";
import { handoffs, panels, projects, sprockets, suggestions } from "./db.ts";
import { ownedPath, ownerOf, projectOwners } from "./owners.ts";
import { postEvent } from "./sprockets.ts";
import { sessionTitle } from "./titles.ts";
import { looksLikeQuestion } from "./watches.ts";

/** How much of the reply's end the event keeps. */
const TAIL = 1200;
/** A message the reporting session wrote to the other one within this long already passed it on. */
const WROTE_MS = 10 * 60_000;

/** Paths and file names in prose: `src/ui/audio.js`, `audio.js`, `./src/game/`. */
const PATH = /(?:\.{0,2}\/)?(?:[\w@.-]+\/)+[\w@.-]*|[\w@-]+(?:\.[\w-]+)*\.(?:[cm]?[jt]sx?|css|s[ac]ss|html?|json|md|py|rs|go|java|kt|rb|php|swift|sh|ya?ml|toml|sql|svelte|vue)\b/g;
/** Words that say something is wrong or needed, near a file another session has. */
const CUE =
  /\b(but|however|doesn['’]?t|does not|don['’]?t|isn['’]?t|aren['’]?t|won['’]?t|can['’]?t|never|mismatch\w*|expects?|expected|missing|wrong|broken|breaks?|fail(s|ing|ed)?|needs?( to)?|should|must|still|instead|todo|follow[- ]?up|out of (sync|date)|stale|undefined|crash\w*|bug)\b/i;

/** The sentences of a reply, roughly: lines, then sentence ends. */
const sentences = (text: string) => text.split(/\n+|(?<=[.!?])\s+/).filter((s) => s.trim());

export interface Finding {
  panelId: string;
  /** The other session's files the reply names, relative to the project. */
  files: string[];
}

/**
 * The other sessions whose files a reply names next to a sign that something's wrong or needed there (see the top of
 * this file). `reporter` is the session that wrote it; only live agent sessions in its project count.
 */
export function findingsIn(reporter: Panel, text: string, now = Date.now()): Finding[] {
  const project = projects.get(reporter.projectId);
  if (!project) return [];
  const recent = (p: Panel) => cardOf(p).edits.filter((e) => now - Date.parse(e.at) < OVERLAP_MS).map((e) => rel(project.path, e.file));
  const mine = new Set(recent(reporter));
  const others = panels.list(project.id).filter((p) => p.id !== reporter.id && p.kind !== "shell" && cardOf(p).status !== "ended");
  if (!others.length) return [];
  const changed = new Map(others.map((p) => [p.id, recent(p)]));
  const owned = projectOwners(project.id).filter((o) => o.panelId !== reporter.id);
  const found = new Map<string, Set<string>>();
  const add = (panelId: string, file: string) => {
    if (mine.has(file) || !others.some((p) => p.id === panelId)) return;
    found.set(panelId, (found.get(panelId) ?? new Set()).add(file));
  };
  for (const sentence of sentences(text)) {
    if (!CUE.test(sentence)) continue;
    for (const [token] of sentence.matchAll(PATH)) {
      const raw = token.replace(/^\.\//, "").replace(/[.,:;)]+$/, "");
      if (!raw) continue;
      if (raw.includes("/")) {
        // A path: by who owns it, and by who changed it (or a file under it) lately.
        const relPath = ownedPath(project, raw);
        if (!relPath) continue;
        const owner = ownerOf(project.id, relPath);
        if (owner) add(owner, relPath);
        else for (const o of owned) if (o.paths.some((p) => p === relPath || p.startsWith(relPath + "/"))) add(o.panelId, relPath);
        for (const [id, files] of changed) for (const f of files) if (f === relPath || f.startsWith(relPath + "/")) add(id, f);
      } else {
        // A bare file name: only by who changed a file of that name lately (a name alone says nothing about owners).
        for (const [id, files] of changed) for (const f of files) if (basename(f) === raw) add(id, f);
      }
    }
  }
  return [...found].map(([panelId, files]) => ({ panelId, files: [...files] }));
}

/** Whether the reporting session already told the other one (its message, ADR 0018), or a handoff will (ADR 0015). */
function covered(reporter: Panel, otherId: string, now: number): boolean {
  const since = new Date(now - WROTE_MS).toISOString();
  if (suggestions.byAgent(reporter.id, since).some((s) => s.panelId === otherId && s.status !== "dismissed")) return true;
  return handoffs.pendingAt(reporter.id).some((h) => h.from.panelId === reporter.id && h.to.panelId === otherId);
}

/** Which pairs were reported for which file, when: once per OVERLAP_MS. */
const reported = new Map<string, number>();

/** A turn end from `panel`: wake its project's Coordinator for what it found in other sessions' files, if anything. */
export async function noteFinding(panel: Panel, text: string, now = Date.now()): Promise<boolean> {
  if (panel.kind === "shell" || !text.trim() || looksLikeQuestion(text)) return false;
  const coordinator = sprockets.coordinatorOf(panel.projectId);
  if (!coordinator) return false;
  const fresh = findingsIn(panel, text, now)
    .filter((f) => !covered(panel, f.panelId, now))
    .map((f) => ({ ...f, files: f.files.filter((file) => now - (reported.get(`${panel.id} ${f.panelId} ${file}`) ?? -Infinity) >= OVERLAP_MS) }))
    .filter((f) => f.files.length);
  if (!fresh.length) return false;
  if (reported.size > 1000) for (const [k, at] of reported) if (now - at >= OVERLAP_MS) reported.delete(k);
  for (const f of fresh) for (const file of f.files) reported.set(`${panel.id} ${f.panelId} ${file}`, now);
  const title = await sessionTitle(panel);
  const findings = await Promise.all(
    fresh.flatMap((f) => {
      const p = panels.get(f.panelId);
      return p ? [sessionTitle(p).then((t) => ({ panelId: p.id, kind: p.kind, title: t, ...(p.sessionId ? { sessionId: p.sessionId } : {}), files: f.files.slice(0, 10) }))] : [];
    }),
  );
  const event: SprocketEvent = { panelId: panel.id, kind: panel.kind, title, ...(panel.sessionId ? { sessionId: panel.sessionId } : {}), what: "finding", findings };
  // Still this project's Coordinator (the lookups took a moment)?
  const now2 = sprockets.get(coordinator.id);
  if (!now2?.coordinator || now2.projectId !== panel.projectId) return false;
  postEvent(coordinator.id, event, text.length > TAIL ? "…" + text.slice(-TAIL) : text);
  return true;
}

/** Follow every session's turn ends. */
export function startFindings(): void {
  onEvents((panel, events: SessionEvent[]) => {
    for (const e of events) if (e.kind === "turn_end") void noteFinding(panel, e.text).catch((err) => console.error("findings:", err));
  });
  onPanelForgotten((id) => {
    for (const k of reported.keys()) if (k.includes(id)) reported.delete(k);
  });
}
