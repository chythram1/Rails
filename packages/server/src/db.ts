import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Project } from "@rails/shared";
import { RAILS_HOME } from "./config.ts";

const db = new DatabaseSync(join(RAILS_HOME, "rails.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
`);

type Row = { id: string; name: string; path: string; created_at: string };
const toProject = (r: Row): Project => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at });

export const projects = {
  list(): Project[] {
    return (db.prepare("SELECT * FROM projects ORDER BY name COLLATE NOCASE").all() as Row[]).map(toProject);
  },
  get(id: string): Project | undefined {
    const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    return r && toProject(r);
  },
  create(name: string, path: string): Project {
    const p: Project = { id: randomUUID(), name, path, createdAt: new Date().toISOString() };
    db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)").run(p.id, p.name, p.path, p.createdAt);
    return p;
  },
  remove(id: string): void {
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  },
};
