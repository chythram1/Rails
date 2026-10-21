import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DecisionEntry, Handoff, Panel, PanelKind, Project, Sprocket, SprocketAuthor, SprocketEvent, SprocketLook, SprocketMessage, Suggestion } from "@rails/shared";
import { RAILS_HOME } from "./config.ts";

const db = new DatabaseSync(join(RAILS_HOME, "rails.db"));
// Write-ahead logging, so someone reading the file (sqlite3 in a terminal, a backup) can't block a write, and a
// short wait for another writer instead of failing at once. Without them, session events got lost. The wait is
// synchronous (node:sqlite), so it holds the event loop, but only while another process writes to the file,
// which normally never happens.
db.exec("PRAGMA busy_timeout = 2000; PRAGMA journal_mode = WAL;"); // the wait first: the switch itself may wait for a reader

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
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/** Add a column to a table made by an older version. SQLite has no ADD COLUMN IF NOT EXISTS. */
function addColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn("sprockets", "project_id", "TEXT");
addColumn("sprockets", "model", "TEXT");
addColumn("sprockets", "core_memory", "TEXT NOT NULL DEFAULT ''");
addColumn("sprockets", "description", "TEXT NOT NULL DEFAULT ''");
addColumn("sprockets", "codemode_store", "TEXT NOT NULL DEFAULT '{}'");
/** 1 for its project's Coordinator (at most one per project). */
addColumn("sprockets", "coordinator", "INTEGER NOT NULL DEFAULT 0");
/** Its standing rules (ADR 0011), as a JSON array of sentences. */
addColumn("sprockets", "rules", "TEXT NOT NULL DEFAULT '[]'");
// One Sprocket per project (ADR 0016), which is its Coordinator. Where a project still has several, its Coordinator
// (or else the oldest) keeps it; the others are detached and keep their chats, so nothing is lost.
db.exec(`
  UPDATE sprockets SET project_id = NULL, coordinator = 0, codemode_store = '{}'
    WHERE project_id IS NOT NULL AND id != (
      SELECT s2.id FROM sprockets s2 WHERE s2.project_id = sprockets.project_id ORDER BY s2.coordinator DESC, s2.created_at, s2.id LIMIT 1);
  UPDATE sprockets SET coordinator = (project_id IS NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS sprockets_one_per_project ON sprockets (project_id) WHERE project_id IS NOT NULL;
`);
addColumn("sprocket_messages", "author", "TEXT NOT NULL DEFAULT 'user'");
addColumn("sprocket_messages", "activity", "TEXT");
/** On a reply: the run's tool calls and results (pi-ai messages, JSON), replayed to later runs. Never sent to browsers. */
addColumn("sprocket_messages", "steps", "TEXT");
/** On an event: the SprocketEvent, as JSON. */
addColumn("sprocket_messages", "event", "TEXT");
addColumn("panels", "bridge_token", "TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS session_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id TEXT NOT NULL,
    session_id TEXT,
    at TEXT NOT NULL,
    event TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_events_by_panel ON session_events (panel_id, id);
  -- Replies a Coordinator suggests sending to sessions (ADR 0010). message_id is the reply they came with;
  -- it's null while that reply is being written.
  CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    sprocket_id TEXT NOT NULL,
    message_id TEXT,
    panel_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    session_id TEXT,
    mode TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS suggestions_by_panel ON suggestions (panel_id, status);
  CREATE INDEX IF NOT EXISTS suggestions_by_sprocket ON suggestions (sprocket_id, message_id);
`);
/** On a suggestion: the rule it followed (ADR 0011). */
addColumn("suggestions", "rule", "TEXT");
/** On a sent suggestion: 1 if it went into the session's own queue (it was busy). */
addColumn("suggestions", "queued", "INTEGER NOT NULL DEFAULT 0");
/** On a handoff's message: what the finished session said last, as JSON {title, text} (ADR 0015). */
addColumn("suggestions", "attachment", "TEXT");
/** On an agent's message: the session that drafted it, as JSON {panelId, kind, title} (ADR 0018). */
addColumn("suggestions", "sender", "TEXT");
db.exec(`
  -- Shadow judgments of the fast decision model (ADR 0012). Kept to the latest few hundred.
  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    panel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    question TEXT NOT NULL,
    text TEXT NOT NULL,
    rails TEXT NOT NULL,
    answer TEXT,
    model TEXT,
    latency_ms INTEGER,
    cost REAL,
    error TEXT,
    event_message_id TEXT
  );
  CREATE INDEX IF NOT EXISTS decisions_by_panel ON decisions (panel_id, at);
`);
db.exec(`
  -- Handoffs a Coordinator planned (ADR 0015). Status: pending, done, cancelled or expired.
  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    sprocket_id TEXT NOT NULL,
    from_panel_id TEXT NOT NULL,
    from_kind TEXT NOT NULL,
    from_title TEXT NOT NULL,
    to_panel_id TEXT NOT NULL,
    to_kind TEXT NOT NULL,
    to_title TEXT NOT NULL,
    note TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS handoffs_pending ON handoffs (status, sprocket_id);
  -- Which files or folders each session owns (ADR 0016), relative to its project.
  CREATE TABLE IF NOT EXISTS owners (
    panel_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (panel_id, path)
  );
  CREATE INDEX IF NOT EXISTS owners_by_project ON owners (project_id);
  -- What each Sprocket run used (tokens, and cost when the provider reports it), quiet runs included.
  CREATE TABLE IF NOT EXISTS sprocket_usage (
    sprocket_id TEXT NOT NULL,
    at TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    cost REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sprocket_usage_by_sprocket ON sprocket_usage (sprocket_id);
`);
/** On a judgment: 1 when it woke the Coordinator itself (ADR 0013). */
addColumn("decisions", "acted", "INTEGER NOT NULL DEFAULT 0");
addColumn("handoffs", "from_session_id", "TEXT");
addColumn("handoffs", "to_session_id", "TEXT");

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
  all(): Panel[] {
    return (db.prepare("SELECT * FROM panels ORDER BY created_at").all() as PanelRow[]).map(toPanel);
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
  setSession(id: string, sessionId: string): void {
    db.prepare("UPDATE panels SET session_id = ? WHERE id = ?").run(sessionId, id);
  },
  /** The panel's bridge token (ADR 0007), made when the panel starts. Never sent to browsers. */
  bridgeToken(id: string): string | undefined {
    return (db.prepare("SELECT bridge_token FROM panels WHERE id = ?").get(id) as { bridge_token: string | null } | undefined)?.bridge_token ?? undefined;
  },
  setBridgeToken(id: string, token: string): void {
    db.prepare("UPDATE panels SET bridge_token = ? WHERE id = ?").run(token, id);
  },
};

/** What sessions reported through the bridge (ADR 0007), kept short: the last EVENTS_PER_PANEL per panel. */
const EVENTS_PER_PANEL = 200;
export const sessionEvents = {
  add(panelId: string, sessionId: string | undefined, event: unknown, at = new Date().toISOString()): void {
    db.prepare("INSERT INTO session_events (panel_id, session_id, at, event) VALUES (?, ?, ?, ?)").run(panelId, sessionId ?? null, at, JSON.stringify(event));
    db.prepare("DELETE FROM session_events WHERE panel_id = ? AND id <= (SELECT id FROM session_events WHERE panel_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)").run(
      panelId,
      panelId,
      EVENTS_PER_PANEL,
    );
  },
  list(panelId: string): { at: string; sessionId?: string; event: any }[] {
    return (db.prepare("SELECT at, session_id, event FROM session_events WHERE panel_id = ? ORDER BY id").all(panelId) as { at: string; session_id: string | null; event: string }[]).map(
      (r) => ({ at: r.at, sessionId: r.session_id ?? undefined, event: JSON.parse(r.event) }),
    );
  },
  removePanel(panelId: string): void {
    db.prepare("DELETE FROM session_events WHERE panel_id = ?").run(panelId);
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

// Sprockets (ADR 0005, 0006). `look` is stored as JSON and validated by the service when read.
type SprocketRow = {
  id: string;
  name: string;
  look: string;
  created_at: string;
  project_id: string | null;
  model: string | null;
  description: string;
  core_memory: string;
  coordinator: number;
  rules: string;
};
/** A stored Sprocket, with its internal core memory (never sent to browsers). */
const toSprocket = (r: SprocketRow): Omit<Sprocket, "look" | "running" | "pending" | "handoffs" | "owners" | "usage"> & { look: unknown; coreMemory: string } => ({
  id: r.id,
  name: r.name,
  look: JSON.parse(r.look),
  createdAt: r.created_at,
  projectId: r.project_id ?? undefined,
  model: r.model ?? undefined,
  description: r.description,
  coordinator: r.coordinator === 1,
  rules: JSON.parse(r.rules),
  coreMemory: r.core_memory,
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
  byProject(projectId: string) {
    return (db.prepare("SELECT * FROM sprockets WHERE project_id = ? ORDER BY created_at").all(projectId) as SprocketRow[]).map(toSprocket);
  },
  /**
   * Move to another project (or none). Its chat belongs to the old attachment, so it goes. Attached, it's the
   * project's Coordinator (ADR 0016); the unique index keeps it to one per project.
   */
  setProject(id: string, projectId: string | null): void {
    db.prepare("DELETE FROM sprocket_messages WHERE sprocket_id = ?").run(id);
    db.prepare("DELETE FROM suggestions WHERE sprocket_id = ?").run(id);
    db.prepare("UPDATE sprockets SET project_id = ?, codemode_store = '{}', coordinator = ? WHERE id = ?").run(projectId, projectId ? 1 : 0, id);
  },
  coordinatorOf(projectId: string) {
    const r = db.prepare("SELECT * FROM sprockets WHERE project_id = ? AND coordinator = 1").get(projectId) as SprocketRow | undefined;
    return r && toSprocket(r);
  },
  /** Values a Sprocket's scripts keep with store()/load() (harness/codemode.ts). They belong to its project, like its chat. */
  codemodeStore(id: string): Record<string, unknown> {
    const row = db.prepare("SELECT codemode_store FROM sprockets WHERE id = ?").get(id) as { codemode_store: string } | undefined;
    return row ? JSON.parse(row.codemode_store) : {};
  },
  saveCodemodeStore(id: string, writes: { set: Record<string, unknown>; delete: string[] }): void {
    const store = { ...this.codemodeStore(id), ...writes.set };
    for (const key of writes.delete) delete store[key];
    db.prepare("UPDATE sprockets SET codemode_store = ? WHERE id = ?").run(JSON.stringify(store), id);
  },
  setModel(id: string, model: string | null): void {
    db.prepare("UPDATE sprockets SET model = ? WHERE id = ?").run(model, id);
  },
  setRules(id: string, rules: string[]): void {
    db.prepare("UPDATE sprockets SET rules = ? WHERE id = ?").run(JSON.stringify(rules), id);
  },
  setDescription(id: string, text: string): void {
    db.prepare("UPDATE sprockets SET description = ? WHERE id = ?").run(text, id);
  },
  setCoreMemory(id: string, text: string): void {
    db.prepare("UPDATE sprockets SET core_memory = ? WHERE id = ?").run(text, id);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM sprocket_messages WHERE sprocket_id = ?").run(id);
    db.prepare("DELETE FROM suggestions WHERE sprocket_id = ?").run(id);
    db.prepare("DELETE FROM sprocket_usage WHERE sprocket_id = ?").run(id);
    db.prepare("DELETE FROM sprockets WHERE id = ?").run(id);
  },
};

type MessageRow = { id: string; sprocket_id: string; author: SprocketAuthor; text: string; created_at: string; activity: string | null; event: string | null };
const toMessage = (r: MessageRow): SprocketMessage => ({
  id: r.id,
  sprocketId: r.sprocket_id,
  author: r.author,
  text: r.text,
  createdAt: r.created_at,
  ...(r.activity ? { activity: r.activity } : {}),
  ...(r.event ? { event: JSON.parse(r.event) } : {}),
});

export const sprocketMessages = {
  /** A chat, with each reply's suggestions. */
  list(sprocketId: string): SprocketMessage[] {
    const byMessage = suggestions.byMessage(sprocketId);
    return (db.prepare("SELECT * FROM sprocket_messages WHERE sprocket_id = ? ORDER BY created_at, rowid").all(sprocketId) as MessageRow[]).map((r) => {
      const m = toMessage(r);
      const list = byMessage.get(m.id);
      return list ? { ...m, suggestions: list } : m;
    });
  },
  last(sprocketId: string): SprocketMessage | undefined {
    const r = db.prepare("SELECT * FROM sprocket_messages WHERE sprocket_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(sprocketId) as MessageRow | undefined;
    return r && toMessage(r);
  },
  create(
    sprocketId: string,
    author: SprocketAuthor,
    text: string,
    createdAt = new Date().toISOString(),
    { activity, steps, event }: { activity?: string; steps?: unknown[]; event?: SprocketEvent } = {},
  ): SprocketMessage {
    const m: SprocketMessage = { id: randomUUID(), sprocketId, author, text, createdAt, ...(activity ? { activity } : {}), ...(event ? { event } : {}) };
    db.prepare("INSERT INTO sprocket_messages (id, sprocket_id, author, text, created_at, activity, steps, event) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      m.id,
      m.sprocketId,
      m.author,
      m.text,
      m.createdAt,
      activity ?? null,
      steps?.length ? JSON.stringify(steps) : null,
      event ? JSON.stringify(event) : null,
    );
    return m;
  },
  /** Mark an event the Coordinator decided the user needn't hear about. */
  setQuiet(id: string): void {
    db.prepare("UPDATE sprocket_messages SET event = json_set(event, '$.quiet', json('true')) WHERE id = ? AND event IS NOT NULL").run(id);
  },
  /** The stored tool steps of the `limit` latest replies of a Sprocket that have them, by message id. */
  recentSteps(sprocketId: string, limit: number): Map<string, unknown[]> {
    const rows = db
      .prepare("SELECT id, steps FROM sprocket_messages WHERE sprocket_id = ? AND steps IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(sprocketId, limit) as { id: string; steps: string }[];
    return new Map(rows.map((r) => [r.id, JSON.parse(r.steps)]));
  },
};

type SuggestionRow = {
  id: string;
  sprocket_id: string;
  message_id: string | null;
  panel_id: string;
  kind: PanelKind;
  title: string;
  session_id: string | null;
  mode: Suggestion["mode"];
  text: string;
  rule: string | null;
  attachment: string | null;
  sender: string | null;
  queued: number;
  status: Suggestion["status"];
  error: string | null;
  created_at: string;
  updated_at: string;
};
const toSuggestion = (r: SuggestionRow): Suggestion & { sprocketId: string; messageId?: string } => ({
  id: r.id,
  sprocketId: r.sprocket_id,
  ...(r.message_id ? { messageId: r.message_id } : {}),
  panelId: r.panel_id,
  kind: r.kind,
  title: r.title,
  ...(r.session_id ? { sessionId: r.session_id } : {}),
  mode: r.mode,
  text: r.text,
  ...(r.rule ? { rule: r.rule } : {}),
  ...(r.attachment ? { attachment: JSON.parse(r.attachment) as NonNullable<Suggestion["attachment"]> } : {}),
  ...(r.sender ? { from: JSON.parse(r.sender) as NonNullable<Suggestion["from"]> } : {}),
  status: r.status,
  ...(r.error ? { error: r.error } : {}),
  ...(r.queued ? { queued: true } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const suggestions = {
  create(s: {
    sprocketId: string;
    panelId: string;
    kind: PanelKind;
    title: string;
    sessionId?: string;
    mode: Suggestion["mode"];
    text: string;
    rule?: string;
    attachment?: Suggestion["attachment"];
    from?: Suggestion["from"];
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO suggestions (id, sprocket_id, panel_id, kind, title, session_id, mode, text, rule, attachment, sender, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    ).run(
      id,
      s.sprocketId,
      s.panelId,
      s.kind,
      s.title,
      s.sessionId ?? null,
      s.mode,
      s.text,
      s.rule ?? null,
      s.attachment ? JSON.stringify(s.attachment) : null,
      s.from ? JSON.stringify(s.from) : null,
      now,
      now,
    );
    return this.get(id)!;
  },
  get(id: string) {
    const r = db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id) as SuggestionRow | undefined;
    return r && toSuggestion(r);
  },
  /** A Sprocket's shown suggestions (those whose reply was saved), by reply. */
  byMessage(sprocketId: string): Map<string, Suggestion[]> {
    const rows = db.prepare("SELECT * FROM suggestions WHERE sprocket_id = ? AND message_id IS NOT NULL ORDER BY created_at, rowid").all(sprocketId) as SuggestionRow[];
    const map = new Map<string, Suggestion[]>();
    for (const r of rows) {
      const { sprocketId: _s, messageId: _m, ...s } = toSuggestion(r);
      map.set(r.message_id!, [...(map.get(r.message_id!) ?? []), s]);
    }
    return map;
  },
  /** Panels where a Sprocket's shown suggestions wait for the user. */
  pendingPanels(sprocketId: string): string[] {
    const rows = db.prepare("SELECT DISTINCT panel_id FROM suggestions WHERE sprocket_id = ? AND status = 'pending' AND message_id IS NOT NULL").all(sprocketId) as { panel_id: string }[];
    return rows.map((r) => r.panel_id);
  },
  /** How many of the messages a session drafted for others wait for the user (ADR 0018). */
  pendingFrom(panelId: string): number {
    const r = db.prepare("SELECT count(*) AS n FROM suggestions WHERE status = 'pending' AND json_extract(sender, '$.panelId') = ?").get(panelId) as { n: number };
    return Number(r.n);
  },
  /** Pending ones for a panel (from any Sprocket). */
  pendingFor(panelId: string) {
    return (db.prepare("SELECT * FROM suggestions WHERE panel_id = ? AND status = 'pending'").all(panelId) as SuggestionRow[]).map(toSuggestion);
  },
  /** Sent to a panel in the last hour, newest first. */
  sentTo(panelId: string) {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    return (db.prepare("SELECT * FROM suggestions WHERE panel_id = ? AND status = 'sent' AND updated_at >= ? ORDER BY updated_at DESC").all(panelId, since) as SuggestionRow[]).map(
      toSuggestion,
    );
  },
  /** Show a run's suggestions under the reply it saved. */
  attach(ids: string[], messageId: string): void {
    for (const id of ids) db.prepare("UPDATE suggestions SET message_id = ? WHERE id = ? AND message_id IS NULL").run(messageId, id);
  },
  /** Forget suggestions that never got a reply to show them under. */
  drop(ids: string[]): void {
    for (const id of ids) db.prepare("DELETE FROM suggestions WHERE id = ? AND message_id IS NULL").run(id);
  },
  /** Change the status if it's one of `from`. False when it wasn't (someone else changed it first). */
  setStatus(id: string, from: Suggestion["status"][], to: Suggestion["status"], extra: { error?: string; text?: string; queued?: boolean } = {}): boolean {
    const marks = from.map(() => "?").join(", ");
    const r = db
      .prepare(`UPDATE suggestions SET status = ?, error = ?, text = COALESCE(?, text), queued = ?, updated_at = ? WHERE id = ? AND status IN (${marks})`)
      .run(to, extra.error ?? null, extra.text ?? null, extra.queued ? 1 : 0, new Date().toISOString(), id, ...from);
    return r.changes > 0;
  },
};

type DecisionRow = {
  id: string;
  at: string;
  panel_id: string;
  title: string;
  kind: PanelKind;
  question: DecisionEntry["question"];
  text: string;
  rails: DecisionEntry["rails"];
  answer: string | null;
  model: string | null;
  latency_ms: number | null;
  cost: number | null;
  error: string | null;
  event_message_id: string | null;
  acted: number;
  quiet: number | null;
};
/** Most judgments kept. */
const DECISIONS_KEPT = 500;

export const decisions = {
  create(d: { panelId: string; title: string; kind: PanelKind; question: DecisionEntry["question"]; text: string; rails: DecisionEntry["rails"] }): string {
    const id = randomUUID();
    db.prepare("INSERT INTO decisions (id, at, panel_id, title, kind, question, text, rails) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      new Date().toISOString(),
      d.panelId,
      d.title,
      d.kind,
      d.question,
      d.text,
      d.rails,
    );
    db.prepare("DELETE FROM decisions WHERE id NOT IN (SELECT id FROM decisions ORDER BY at DESC LIMIT ?)").run(DECISIONS_KEPT);
    return id;
  },
  setTitle(id: string, title: string): void {
    db.prepare("UPDATE decisions SET title = ? WHERE id = ?").run(title, id);
  },
  /** The model's answer (or why there's none). */
  finish(id: string, r: { answer?: DecisionEntry["answer"]; model?: string; latencyMs?: number; cost?: number; error?: string }): void {
    db.prepare("UPDATE decisions SET answer = ?, model = ?, latency_ms = ?, cost = ?, error = ? WHERE id = ?").run(
      r.answer ? JSON.stringify(r.answer) : null,
      r.model ?? null,
      r.latencyMs ?? null,
      r.cost ?? null,
      r.error ?? null,
      id,
    );
  },
  /**
   * The Coordinator was woken for a panel's turn end: link the event to that turn end's judgment (the latest
   * one Rails' code said asks, since only those wake it), for the outcome.
   */
  linkWake(panelId: string, messageId: string, since: string): void {
    db.prepare(
      "UPDATE decisions SET event_message_id = ? WHERE id = (SELECT id FROM decisions WHERE panel_id = ? AND question = 'turn_end' AND rails = 'asks' AND event_message_id IS NULL AND at >= ? ORDER BY at DESC LIMIT 1)",
    ).run(messageId, panelId, since);
  },
  /** The model's own wake (ADR 0013): this judgment woke the Coordinator, with this event. */
  linkActed(id: string, messageId: string): void {
    db.prepare("UPDATE decisions SET event_message_id = ?, acted = 1 WHERE id = ?").run(messageId, id);
  },
  /** The latest judgments, newest first, with the outcome of the wakes they led to. */
  list(limit: number): DecisionEntry[] {
    const rows = db
      .prepare(
        `SELECT d.*, CASE WHEN m.id IS NULL THEN NULL WHEN json_extract(m.event, '$.quiet') THEN 1 ELSE 0 END AS quiet
         FROM decisions d LEFT JOIN sprocket_messages m ON m.id = d.event_message_id ORDER BY d.at DESC LIMIT ?`,
      )
      .all(limit) as DecisionRow[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      panelId: r.panel_id,
      title: r.title,
      kind: r.kind,
      question: r.question,
      text: r.text,
      rails: r.rails,
      ...(r.answer ? { answer: JSON.parse(r.answer) } : {}),
      ...(r.quiet === null ? {} : { outcome: r.quiet ? "nothing needed" : "told you" }),
      ...(r.acted ? { acted: true } : {}),
      ...(r.model ? { model: r.model } : {}),
      ...(r.latency_ms !== null ? { latencyMs: r.latency_ms } : {}),
      ...(r.cost !== null ? { cost: r.cost } : {}),
      ...(r.error ? { error: r.error } : {}),
    }));
  },
};

/** Small app settings (the default model, this install's id), as key/value text. */
export const settings = {
  get(key: string): string | undefined {
    return (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  },
  set(key: string, value: string | null): void {
    if (value === null) db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    else db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  },
};

type HandoffRow = {
  id: string;
  sprocket_id: string;
  from_panel_id: string;
  from_kind: PanelKind;
  from_title: string;
  to_panel_id: string;
  to_kind: PanelKind;
  to_title: string;
  from_session_id: string | null;
  to_session_id: string | null;
  note: string;
  status: string;
  created_at: string;
};
export type StoredHandoff = Handoff & { sprocketId: string };
const toHandoff = (r: HandoffRow): StoredHandoff => ({
  id: r.id,
  sprocketId: r.sprocket_id,
  from: { panelId: r.from_panel_id, kind: r.from_kind, title: r.from_title, ...(r.from_session_id ? { sessionId: r.from_session_id } : {}) },
  to: { panelId: r.to_panel_id, kind: r.to_kind, title: r.to_title, ...(r.to_session_id ? { sessionId: r.to_session_id } : {}) },
  note: r.note,
  createdAt: r.created_at,
});
/** Handoffs Coordinators planned (ADR 0015); only pending ones are read back. */
export const handoffs = {
  create(sprocketId: string, h: Omit<Handoff, "id" | "createdAt">): StoredHandoff {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO handoffs (id, sprocket_id, from_panel_id, from_kind, from_title, from_session_id, to_panel_id, to_kind, to_title, to_session_id, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    ).run(id, sprocketId, h.from.panelId, h.from.kind, h.from.title, h.from.sessionId ?? null, h.to.panelId, h.to.kind, h.to.title, h.to.sessionId ?? null, h.note, now, now);
    return { id, sprocketId, ...h, createdAt: now };
  },
  /** Pending ones, oldest first: a Sprocket's, or all of them. */
  pending(sprocketId?: string): StoredHandoff[] {
    const rows = sprocketId
      ? db.prepare("SELECT * FROM handoffs WHERE status = 'pending' AND sprocket_id = ? ORDER BY created_at, rowid").all(sprocketId)
      : db.prepare("SELECT * FROM handoffs WHERE status = 'pending' ORDER BY created_at, rowid").all();
    return (rows as HandoffRow[]).map(toHandoff);
  },
  /** Pending ones that start or end at a panel. */
  pendingAt(panelId: string): StoredHandoff[] {
    return (db.prepare("SELECT * FROM handoffs WHERE status = 'pending' AND (from_panel_id = ? OR to_panel_id = ?) ORDER BY created_at, rowid").all(panelId, panelId) as HandoffRow[]).map(toHandoff);
  },
  /** A pending one's session got a (better) title. True when one changed. */
  retitle(panelId: string, title: string): boolean {
    const now = new Date().toISOString();
    const a = db.prepare("UPDATE handoffs SET from_title = ?, updated_at = ? WHERE status = 'pending' AND from_panel_id = ? AND from_title != ?").run(title, now, panelId, title).changes;
    const b = db.prepare("UPDATE handoffs SET to_title = ?, updated_at = ? WHERE status = 'pending' AND to_panel_id = ? AND to_title != ?").run(title, now, panelId, title).changes;
    return Number(a) + Number(b) > 0;
  },
  /** A pending one's side now follows another session (handoffs.ts, followSessions). */
  setSession(id: string, side: "from" | "to", sessionId: string): void {
    db.prepare(`UPDATE handoffs SET ${side}_session_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).run(sessionId, new Date().toISOString(), id);
  },
  /** End a pending one. False when it wasn't pending (someone else ended it first). */
  end(id: string, status: "done" | "cancelled" | "expired"): boolean {
    return db.prepare("UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(status, new Date().toISOString(), id).changes > 0;
  },
};

/** Which files or folders sessions own (ADR 0016). */
export const owners = {
  list(projectId: string): { panelId: string; path: string }[] {
    return (db.prepare("SELECT panel_id, path FROM owners WHERE project_id = ? ORDER BY created_at, rowid").all(projectId) as { panel_id: string; path: string }[]).map(
      (r) => ({ panelId: r.panel_id, path: r.path }),
    );
  },
  /** Replace what a panel owns. */
  set(projectId: string, panelId: string, paths: string[]): void {
    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM owners WHERE panel_id = ?").run(panelId);
      for (const p of paths) db.prepare("INSERT INTO owners (panel_id, project_id, path, created_at) VALUES (?, ?, ?, ?)").run(panelId, projectId, p, now);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
  /** True when it owned anything. */
  clear(panelId: string): boolean {
    return db.prepare("DELETE FROM owners WHERE panel_id = ?").run(panelId).changes > 0;
  },
};

/** What Sprocket runs used. */
export const usage = {
  add(sprocketId: string, tokens: number, cost: number): void {
    db.prepare("INSERT INTO sprocket_usage (sprocket_id, at, tokens, cost) VALUES (?, ?, ?, ?)").run(sprocketId, new Date().toISOString(), tokens, cost);
  },
  total(sprocketId: string): { runs: number; tokens: number; cost: number } {
    const r = db.prepare("SELECT count(*) AS runs, coalesce(sum(tokens), 0) AS tokens, coalesce(sum(cost), 0) AS cost FROM sprocket_usage WHERE sprocket_id = ?").get(sprocketId) as {
      runs: number;
      tokens: number;
      cost: number;
    };
    return { runs: Number(r.runs), tokens: Number(r.tokens), cost: Number(r.cost) };
  },
};
