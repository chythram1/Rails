// Reading the run's database. Rails uses write-ahead logging, so a read-only reader never blocks its writes (an
// earlier run lost session events to a reader before it did).
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export function openDb(home: string): DatabaseSync {
  return new DatabaseSync(join(home, "rails.db"), { readOnly: true });
}

export const all = <T = any>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T[] => db.prepare(sql).all(...params) as T[];
export const one = <T = any>(db: DatabaseSync, sql: string, ...params: (string | number | null)[]): T | undefined => db.prepare(sql).get(...params) as T | undefined;

/** The sessions the run's panels used (their current ones, and any their events name), by id and agent. */
export function sessionsOf(db: DatabaseSync, panels: { id: string; kind: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of panels)
    for (const r of all<{ id: string }>(
      db,
      "SELECT session_id AS id FROM panels WHERE id = ? AND session_id IS NOT NULL UNION SELECT DISTINCT session_id FROM session_events WHERE panel_id = ? AND session_id IS NOT NULL",
      p.id,
      p.id,
    ))
      out[r.id] = p.kind;
  return out;
}

/** The latest event kind each panel reported. */
export function lastEvents(db: DatabaseSync, panelIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of panelIds) {
    const r = one<{ kind: string }>(db, "SELECT json_extract(event, '$.kind') AS kind FROM session_events WHERE panel_id = ? ORDER BY id DESC LIMIT 1", id);
    if (r) out.set(id, r.kind);
  }
  return out;
}
