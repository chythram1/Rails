import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Panel, PanelKind, Project, Sprocket, SprocketLook, SprocketMessage } from "@rails/shared";
import { RAILS_HOME } from "./config.ts";

const db = new DatabaseSync(join(RAILS_HOME, "rails.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS panels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    session_id TEXT UNIQUE,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS layouts (
    project_id TEXT PRIMARY KEY,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sprockets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    look TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sprocket_messages (
    id TEXT PRIMARY KEY,
    sprocket_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sprocket_messages_by_sprocket ON sprocket_messages (sprocket_id, created_at);
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

type PanelRow = { id: string; project_id: string; kind: PanelKind; session_id: string | null; title: string; created_at: string };
const toPanel = (r: PanelRow): Panel => ({
  id: r.id,
  projectId: r.project_id,
  kind: r.kind,
  sessionId: r.session_id ?? undefined,
  title: r.title,
  createdAt: r.created_at,
});

export const panels = {
  list(projectId: string): Panel[] {
    return (db.prepare("SELECT * FROM panels WHERE project_id = ? ORDER BY created_at").all(projectId) as PanelRow[]).map(toPanel);
  },
  get(id: string): Panel | undefined {
    const r = db.prepare("SELECT * FROM panels WHERE id = ?").get(id) as PanelRow | undefined;
    return r && toPanel(r);
  },
  bySession(sessionId: string): Panel | undefined {
    const r = db.prepare("SELECT * FROM panels WHERE session_id = ?").get(sessionId) as PanelRow | undefined;
    return r && toPanel(r);
  },
  create(p: Omit<Panel, "id" | "createdAt">): Panel {
    const panel: Panel = { ...p, id: randomUUID(), createdAt: new Date().toISOString() };
    db.prepare("INSERT INTO panels (id, project_id, kind, session_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      panel.id,
      panel.projectId,
      panel.kind,
      panel.sessionId ?? null,
      panel.title,
      panel.createdAt,
    );
    return panel;
  },
  remove(id: string): void {
    db.prepare("DELETE FROM panels WHERE id = ?").run(id);
  },
};

export const layouts = {
  get(projectId: string): unknown | null {
    const r = db.prepare("SELECT json FROM layouts WHERE project_id = ?").get(projectId) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : null;
  },
  set(projectId: string, layout: unknown): void {
    db.prepare("INSERT INTO layouts (project_id, json) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET json = excluded.json").run(
      projectId,
      JSON.stringify(layout),
    );
  },
  remove(projectId: string): void {
    db.prepare("DELETE FROM layouts WHERE project_id = ?").run(projectId);
  },
};

// Sprockets (ADR 0005). `look` is stored as JSON and validated by the service when read.
type SprocketRow = { id: string; name: string; look: string; created_at: string };
const toSprocket = (r: SprocketRow): Omit<Sprocket, "look"> & { look: unknown } => ({
  id: r.id,
  name: r.name,
  look: JSON.parse(r.look),
  createdAt: r.created_at,
});

export const sprockets = {
  list() {
    return (db.prepare("SELECT * FROM sprockets ORDER BY created_at").all() as SprocketRow[]).map(toSprocket);
  },
  get(id: string) {
    const r = db.prepare("SELECT * FROM sprockets WHERE id = ?").get(id) as SprocketRow | undefined;
    return r && toSprocket(r);
  },
  create(name: string, look: SprocketLook) {
    const id = randomUUID();
    db.prepare("INSERT INTO sprockets (id, name, look, created_at) VALUES (?, ?, ?, ?)").run(id, name, JSON.stringify(look), new Date().toISOString());
    return this.get(id)!;
  },
  update(id: string, name: string, look: SprocketLook): void {
    db.prepare("UPDATE sprockets SET name = ?, look = ? WHERE id = ?").run(name, JSON.stringify(look), id);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM sprocket_messages WHERE sprocket_id = ?").run(id);
    db.prepare("DELETE FROM sprockets WHERE id = ?").run(id);
  },
};

type MessageRow = { id: string; sprocket_id: string; text: string; created_at: string };
const toMessage = (r: MessageRow): SprocketMessage => ({ id: r.id, sprocketId: r.sprocket_id, text: r.text, createdAt: r.created_at });

export const sprocketMessages = {
  list(sprocketId: string): SprocketMessage[] {
    return (db.prepare("SELECT * FROM sprocket_messages WHERE sprocket_id = ? ORDER BY created_at").all(sprocketId) as MessageRow[]).map(toMessage);
  },
  last(sprocketId: string): SprocketMessage | undefined {
    const r = db.prepare("SELECT * FROM sprocket_messages WHERE sprocket_id = ? ORDER BY created_at DESC LIMIT 1").get(sprocketId) as MessageRow | undefined;
    return r && toMessage(r);
  },
  create(sprocketId: string, text: string): SprocketMessage {
    const m: SprocketMessage = { id: randomUUID(), sprocketId, text, createdAt: new Date().toISOString() };
    db.prepare("INSERT INTO sprocket_messages (id, sprocket_id, text, created_at) VALUES (?, ?, ?, ?)").run(m.id, m.sprocketId, m.text, m.createdAt);
    return m;
  },
};
