import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AutomationMark, AutomationOutcome, AutomationRun, AutomationSchedule, AutomationTrigger, DecisionEntry, Handoff, Panel, PanelKind, Project, Sprocket, SprocketApproval, SprocketAsk, SprocketAuthor, SprocketCard, SprocketCardAction, SprocketChatKind, SprocketEvent, SprocketLook, SprocketMessage, SavedPrompt, Suggestion } from "@rails/shared";
import { RAILS_HOME } from "./config.ts";

const db = new DatabaseSync(join(RAILS_HOME, "rails.db"));

/**
 * Run `fn`'s writes as one: all of them or, if it throws, none. Inside another transaction it joins that one, so
 * a write that is one step of a larger one (a team removed with its last member) commits with it.
 */
export function tx<T>(fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
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
// Chats (ADR 0021): every Sprocket's direct chat, and the project chat of the project it's attached to. Team chats
// will be another kind. A chat's messages are sprocket_messages with its chat_id.
db.exec(`
  CREATE TABLE IF NOT EXISTS sprocket_chats (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    sprocket_id TEXT NOT NULL,
    project_id TEXT,
    cleared_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sprocket_chats_direct ON sprocket_chats (sprocket_id) WHERE kind = 'direct';
  CREATE UNIQUE INDEX IF NOT EXISTS sprocket_chats_project ON sprocket_chats (sprocket_id) WHERE kind = 'project';
`);
addColumn("sprocket_messages", "chat_id", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS sprocket_messages_by_chat ON sprocket_messages (chat_id, created_at)");
// Team chats (ADR 0022): a name, the lead in sprocket_id, and the members (the lead too) in order. A message's
// sprocket_id is the member that wrote it.
addColumn("sprocket_chats", "name", "TEXT");
db.exec(`
  CREATE TABLE IF NOT EXISTS sprocket_chat_members (
    chat_id TEXT NOT NULL,
    sprocket_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (chat_id, sprocket_id)
  );
  CREATE INDEX IF NOT EXISTS sprocket_chat_members_by_sprocket ON sprocket_chat_members (sprocket_id);
`);
// Runs (ADR 0023): one Sprocket's turn in one chat, queued until it can start. `trigger` is what asked for it
// (user, pass or event), `source_id` the message that did, `from_id` the member who passed the turn and `hop` how
// many passes led to it.
db.exec(`
  CREATE TABLE IF NOT EXISTS sprocket_runs (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sprocket_id TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger TEXT NOT NULL,
    source_id TEXT,
    from_id TEXT,
    hop INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS sprocket_runs_by_status ON sprocket_runs (status, created_at);
  CREATE INDEX IF NOT EXISTS sprocket_runs_by_chat ON sprocket_runs (chat_id, status);
`);
addColumn("sprocket_messages", "run_id", "TEXT");
/** On a pass line (author 'pass'): the member given the turn. */
addColumn("sprocket_messages", "pass_to", "TEXT");
/** On a question with options (ADR 0023): the SprocketAsk, as JSON. */
addColumn("sprocket_messages", "ask", "TEXT");
/** On a card a Sprocket showed (ADR 0024): the SprocketCard, as JSON. */
addColumn("sprocket_messages", "card", "TEXT");
/** On an approval (ADR 0025): the SprocketApproval, as JSON. */
addColumn("sprocket_messages", "approval", "TEXT");
/** On an automation's line (ADR 0032): the AutomationMark, as JSON. */
addColumn("sprocket_messages", "automation", "TEXT");
// Automations (ADR 0032): a Sprocket, a prompt and a schedule (AutomationSchedule as JSON, in `timezone`), and its
// runs. `next_run_at` is when it's due (none while off, or once a schedule stops firing); a run row points at the
// Sprocket run it started and the line it posted.
db.exec(`
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sprocket_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    timezone TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    paused_reason TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    sprocket_run_id TEXT,
    message_id TEXT,
    trigger TEXT NOT NULL,
    outcome TEXT NOT NULL,
    summary TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS automation_runs_by_automation ON automation_runs (automation_id, created_at);
  CREATE INDEX IF NOT EXISTS automation_runs_by_run ON automation_runs (sprocket_run_id);
`);
// Customize (ADR 0025): MCP servers (their secret values are in mcp-secrets.json, not here), and what each
// Sprocket has: servers and skills (skills are folders in RAILS_HOME/skills, by folder name).
db.exec(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    transport TEXT NOT NULL,
    command TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '[]',
    url TEXT NOT NULL DEFAULT '',
    tools TEXT NOT NULL DEFAULT '[]',
    tools_at TEXT,
    policies TEXT NOT NULL DEFAULT '{}',
    status TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sprocket_tools (
    sprocket_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (sprocket_id, kind, item_id)
  );
`);
// The connector (shared CONNECTORS) a server was added from, if any.
addColumn("mcp_servers", "connector", "TEXT");

/**
 * Every Sprocket has its direct chat and an attached one its project chat; messages from before chats go in one:
 * an attached Sprocket's in its project chat, where its events were, an unattached one's in its direct chat.
 */
export function assignChats(): void {
  const now = new Date().toISOString();
  tx(() => {
    const lacking = (kind: SprocketChatKind, where: string) =>
      db.prepare(`SELECT id, project_id FROM sprockets WHERE ${where} AND id NOT IN (SELECT sprocket_id FROM sprocket_chats WHERE kind = ?)`).all(kind) as {
        id: string;
        project_id: string | null;
      }[];
    for (const r of lacking("direct", "1"))
      db.prepare("INSERT INTO sprocket_chats (id, kind, sprocket_id, created_at) VALUES (?, 'direct', ?, ?)").run(randomUUID(), r.id, now);
    for (const r of lacking("project", "project_id IS NOT NULL"))
      db.prepare("INSERT INTO sprocket_chats (id, kind, sprocket_id, project_id, created_at) VALUES (?, 'project', ?, ?, ?)").run(randomUUID(), r.id, r.project_id, now);
    db.exec(`
      UPDATE sprocket_messages SET chat_id = (
        SELECT c.id FROM sprocket_chats c JOIN sprockets s ON s.id = c.sprocket_id
        WHERE c.sprocket_id = sprocket_messages.sprocket_id AND c.kind = CASE WHEN s.project_id IS NULL THEN 'direct' ELSE 'project' END
      ) WHERE chat_id IS NULL
    `);
  });
}
assignChats();
addColumn("panels", "bridge_token", "TEXT");
/** The agent profile it started with (ADR 0020, removed by ADR 0025): no longer written or read. */
addColumn("panels", "profile", "TEXT");
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
/** On a sent suggestion: 1 while the idle session it went to hasn't shown it took it (Suggestion.unconfirmed). */
addColumn("suggestions", "unconfirmed", "INTEGER NOT NULL DEFAULT 0");
addColumn("suggestions", "edited", "INTEGER NOT NULL DEFAULT 0");
/** On an answer Rails can give a pi dialog itself: JSON {id, option?, text?} (ADR 0027). */
addColumn("suggestions", "dialog", "TEXT");
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
  -- Agent profiles (ADR 0020), removed by ADR 0025: kept, unread, so nothing the user made is deleted.
  CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_prompts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
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
  -- The names the user gave sessions in Rails (names.ts), by session, so they outlive the panels.
  CREATE TABLE IF NOT EXISTS session_names (
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, session_id)
  );
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
const toSprocket = (r: SprocketRow): Omit<Sprocket, "look" | "running" | "pending" | "handoffs" | "owners" | "usage" | "direct" | "projectChat" | "tools"> & { look: unknown; coreMemory: string } => ({
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
    const now = new Date().toISOString();
    tx(() => {
      db.prepare("INSERT INTO sprockets (id, name, look, created_at) VALUES (?, ?, ?, ?)").run(id, name, JSON.stringify(look), now);
      db.prepare("INSERT INTO sprocket_chats (id, kind, sprocket_id, created_at) VALUES (?, 'direct', ?, ?)").run(randomUUID(), id, now);
    });
    return this.get(id)!;
  },
  update(id: string, name: string, look: SprocketLook): void {
    db.prepare("UPDATE sprockets SET name = ?, look = ? WHERE id = ?").run(name, JSON.stringify(look), id);
  },
  byProject(projectId: string) {
    return (db.prepare("SELECT * FROM sprockets WHERE project_id = ? ORDER BY created_at").all(projectId) as SprocketRow[]).map(toSprocket);
  },
  /**
   * Move to another project (or none). The old project's chat goes, and its suggestions with it; the direct chat
   * stays (ADR 0021). Attached, it's the project's Coordinator (ADR 0016), with a new project chat; the unique index
   * keeps it to one per project.
   */
  setProject(id: string, projectId: string | null): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_messages WHERE chat_id IN (SELECT id FROM sprocket_chats WHERE sprocket_id = ? AND kind = 'project')").run(id);
      db.prepare("DELETE FROM sprocket_chats WHERE sprocket_id = ? AND kind = 'project'").run(id);
      db.prepare("DELETE FROM suggestions WHERE sprocket_id = ?").run(id);
      db.prepare("UPDATE sprockets SET project_id = ?, codemode_store = '{}', coordinator = ? WHERE id = ?").run(projectId, projectId ? 1 : 0, id);
      if (projectId)
        db.prepare("INSERT INTO sprocket_chats (id, kind, sprocket_id, project_id, created_at) VALUES (?, 'project', ?, ?, ?)").run(randomUUID(), id, projectId, new Date().toISOString());
    });
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
  /**
   * Delete it with its own chats. In its teams (ADR 0022) what it wrote stays; it leaves them, the next member
   * leads where it led, and a team with nobody left goes.
   */
  remove(id: string): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_messages WHERE chat_id IN (SELECT id FROM sprocket_chats WHERE sprocket_id = ? AND kind != 'team')").run(id);
      db.prepare("DELETE FROM sprocket_chats WHERE sprocket_id = ? AND kind != 'team'").run(id);
      const teams = (db.prepare("SELECT chat_id FROM sprocket_chat_members WHERE sprocket_id = ?").all(id) as { chat_id: string }[]).map((r) => r.chat_id);
      db.prepare("DELETE FROM sprocket_chat_members WHERE sprocket_id = ?").run(id);
      for (const chatId of teams) {
        const [lead] = sprocketChats.members(chatId);
        if (lead) db.prepare("UPDATE sprocket_chats SET sprocket_id = ? WHERE id = ?").run(lead, chatId);
        else sprocketChats.removeTeam(chatId);
      }
      db.prepare("DELETE FROM suggestions WHERE sprocket_id = ?").run(id);
      db.prepare("DELETE FROM sprocket_runs WHERE sprocket_id = ? AND status IN ('queued', 'waiting')").run(id);
      db.prepare("DELETE FROM sprocket_usage WHERE sprocket_id = ?").run(id);
      db.prepare("DELETE FROM sprocket_tools WHERE sprocket_id = ?").run(id);
      db.prepare("DELETE FROM automation_runs WHERE automation_id IN (SELECT id FROM automations WHERE sprocket_id = ?)").run(id);
      db.prepare("DELETE FROM automations WHERE sprocket_id = ?").run(id);
      db.prepare("DELETE FROM sprockets WHERE id = ?").run(id);
    });
  },
};

type ChatRow = {
  id: string;
  kind: SprocketChatKind;
  sprocket_id: string;
  project_id: string | null;
  name: string | null;
  cleared_at: string | null;
  created_at: string;
};
/** A chat. `sprocketId` is the Sprocket that answers it: in a team, its lead. */
export type StoredChat = { id: string; kind: SprocketChatKind; sprocketId: string; projectId?: string; name?: string; clearedAt?: string; createdAt: string };
const toChat = (r: ChatRow): StoredChat => ({
  id: r.id,
  kind: r.kind,
  sprocketId: r.sprocket_id,
  ...(r.project_id ? { projectId: r.project_id } : {}),
  ...(r.name ? { name: r.name } : {}),
  ...(r.cleared_at ? { clearedAt: r.cleared_at } : {}),
  createdAt: r.created_at,
});

/** Sprockets' chats (ADR 0021). They're made and deleted with their Sprocket and its attachment (`sprockets`). */
export const sprocketChats = {
  get(id: string): StoredChat | undefined {
    const r = db.prepare("SELECT * FROM sprocket_chats WHERE id = ?").get(id) as ChatRow | undefined;
    return r && toChat(r);
  },
  of(sprocketId: string, kind: SprocketChatKind): StoredChat | undefined {
    const r = db.prepare("SELECT * FROM sprocket_chats WHERE sprocket_id = ? AND kind = ?").get(sprocketId, kind) as ChatRow | undefined;
    return r && toChat(r);
  },
  /** Delete its messages, and note when (a reply started before then is dropped). */
  clear(id: string): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_messages WHERE chat_id = ?").run(id);
      db.prepare("UPDATE sprocket_chats SET cleared_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    });
  },
  /** Team chats (ADR 0022), oldest first. */
  teams(): StoredChat[] {
    return (db.prepare("SELECT * FROM sprocket_chats WHERE kind = 'team' ORDER BY created_at, rowid").all() as ChatRow[]).map(toChat);
  },
  /** A team's members' ids, the lead first. */
  members(id: string): string[] {
    return (db.prepare("SELECT sprocket_id FROM sprocket_chat_members WHERE chat_id = ? ORDER BY position").all(id) as { sprocket_id: string }[]).map((r) => r.sprocket_id);
  },
  createTeam(name: string, members: string[]): StoredChat {
    const id = randomUUID();
    db.prepare("INSERT INTO sprocket_chats (id, kind, sprocket_id, name, created_at) VALUES (?, 'team', ?, ?, ?)").run(id, members[0], name, new Date().toISOString());
    this.setMembers(id, members);
    return this.get(id)!;
  },
  updateTeam(id: string, name: string, members: string[]): void {
    db.prepare("UPDATE sprocket_chats SET name = ?, sprocket_id = ? WHERE id = ?").run(name, members[0], id);
    this.setMembers(id, members);
  },
  setMembers(id: string, members: string[]): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_chat_members WHERE chat_id = ?").run(id);
      members.forEach((m, i) => db.prepare("INSERT INTO sprocket_chat_members (chat_id, sprocket_id, position) VALUES (?, ?, ?)").run(id, m, i));
    });
  },
  /** A team, its members, its messages and its runs. */
  removeTeam(id: string): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_messages WHERE chat_id = ?").run(id);
      db.prepare("DELETE FROM sprocket_runs WHERE chat_id = ?").run(id);
      db.prepare("DELETE FROM sprocket_chat_members WHERE chat_id = ?").run(id);
      db.prepare("DELETE FROM sprocket_chats WHERE id = ? AND kind = 'team'").run(id);
    });
  },
};

type MessageRow = {
  id: string;
  sprocket_id: string;
  chat_id: string;
  author: SprocketAuthor;
  text: string;
  created_at: string;
  activity: string | null;
  event: string | null;
  pass_to: string | null;
  ask: string | null;
  card: string | null;
  approval: string | null;
  automation: string | null;
};
const toMessage = (r: MessageRow): SprocketMessage => ({
  id: r.id,
  sprocketId: r.sprocket_id,
  chatId: r.chat_id,
  author: r.author,
  text: r.text,
  createdAt: r.created_at,
  ...(r.activity ? { activity: r.activity } : {}),
  ...(r.event ? { event: JSON.parse(r.event) } : {}),
  ...(r.pass_to ? { passTo: r.pass_to } : {}),
  ...(r.ask ? { ask: JSON.parse(r.ask) } : {}),
  ...(r.card ? { card: JSON.parse(r.card) } : {}),
  ...(r.approval ? { approval: JSON.parse(r.approval) } : {}),
  ...(r.automation ? { automation: JSON.parse(r.automation) } : {}),
});

export const sprocketMessages = {
  /** A chat's messages, with each reply's suggestions. */
  list(chatId: string): SprocketMessage[] {
    if (!sprocketChats.get(chatId)) return [];
    const byMessage = suggestions.byMessage(chatId);
    return (db.prepare("SELECT * FROM sprocket_messages WHERE chat_id = ? ORDER BY created_at, rowid").all(chatId) as MessageRow[]).map((r) => {
      const m = toMessage(r);
      const list = byMessage.get(m.id);
      return list ? { ...m, suggestions: list } : m;
    });
  },
  last(chatId: string): SprocketMessage | undefined {
    const r = db.prepare("SELECT * FROM sprocket_messages WHERE chat_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(chatId) as MessageRow | undefined;
    return r && toMessage(r);
  },
  create(
    chatId: string,
    author: SprocketAuthor,
    text: string,
    createdAt = new Date().toISOString(),
    {
      activity,
      steps,
      event,
      sprocketId,
      runId,
      passTo,
      ask,
      card,
      approval,
      automation,
    }: {
      activity?: string;
      steps?: unknown[];
      event?: SprocketEvent;
      sprocketId?: string;
      runId?: string;
      passTo?: string;
      ask?: SprocketAsk;
      card?: SprocketCard;
      approval?: SprocketApproval;
      automation?: AutomationMark;
    } = {},
  ): SprocketMessage {
    const chat = sprocketChats.get(chatId);
    if (!chat) throw new Error(`No chat ${chatId}`);
    // In a team, the member that wrote it; otherwise the chat's Sprocket.
    const m: SprocketMessage = {
      id: randomUUID(),
      sprocketId: sprocketId ?? chat.sprocketId,
      chatId,
      author,
      text,
      createdAt,
      ...(activity ? { activity } : {}),
      ...(event ? { event } : {}),
      ...(passTo ? { passTo } : {}),
      ...(ask ? { ask } : {}),
      ...(card ? { card } : {}),
      ...(approval ? { approval } : {}),
      ...(automation ? { automation } : {}),
    };
    db.prepare(
      "INSERT INTO sprocket_messages (id, sprocket_id, chat_id, author, text, created_at, activity, steps, event, run_id, pass_to, ask, card, approval, automation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      m.id,
      m.sprocketId,
      m.chatId,
      m.author,
      m.text,
      m.createdAt,
      activity ?? null,
      steps?.length ? JSON.stringify(steps) : null,
      event ? JSON.stringify(event) : null,
      runId ?? null,
      passTo ?? null,
      ask ? JSON.stringify(ask) : null,
      card ? JSON.stringify(card) : null,
      approval ? JSON.stringify(approval) : null,
      automation ? JSON.stringify(automation) : null,
    );
    return m;
  },
  /** Add tool steps to a message (a run's last message gets the steps after it, ADR 0023). */
  addSteps(id: string, steps: unknown[]): void {
    if (!steps.length) return;
    const r = db.prepare("SELECT steps FROM sprocket_messages WHERE id = ?").get(id) as { steps: string | null } | undefined;
    if (!r) return;
    db.prepare("UPDATE sprocket_messages SET steps = ? WHERE id = ?").run(JSON.stringify([...(r.steps ? JSON.parse(r.steps) : []), ...steps]), id);
  },
  /** What a reply's run looked at or did ("Looked at the board"), once the run is done. */
  setActivity(id: string, activity: string): void {
    db.prepare("UPDATE sprocket_messages SET activity = ? WHERE id = ?").run(activity, id);
  },
  /** The question a run asked (ask_user), if it asked one: its message's id, and the question. */
  askOf(runId: string): { id: string; ask: SprocketAsk } | undefined {
    const r = db.prepare("SELECT id, ask FROM sprocket_messages WHERE run_id = ? AND ask IS NOT NULL").get(runId) as { id: string; ask: string } | undefined;
    return r && { id: r.id, ask: JSON.parse(r.ask) };
  },
  /** Record the user's answer to a question with options. */
  answer(id: string, answer: string): void {
    db.prepare("UPDATE sprocket_messages SET ask = json_set(ask, '$.answer', ?) WHERE id = ? AND ask IS NOT NULL").run(answer, id);
  },
  /** A message by id (an approval being decided). */
  get(id: string): SprocketMessage | undefined {
    const r = db.prepare("SELECT * FROM sprocket_messages WHERE id = ?").get(id) as MessageRow | undefined;
    return r && toMessage(r);
  },
  /** The messages a run posted, in order. */
  ofRun(runId: string): SprocketMessage[] {
    return (db.prepare("SELECT * FROM sprocket_messages WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as MessageRow[]).map(toMessage);
  },
  /** The run a message came from, if a run posted it. */
  runOf(id: string): string | undefined {
    return (db.prepare("SELECT run_id FROM sprocket_messages WHERE id = ?").get(id) as { run_id: string | null } | undefined)?.run_id ?? undefined;
  },
  /** Record what came of an approval (ADR 0025). */
  /** Replace a card's actions (ADR 0031): the card is the record of what ran. */
  setCardActions(id: string, actions: SprocketCardAction[]): void {
    db.prepare("UPDATE sprocket_messages SET card = json_set(card, '$.actions', json(?)) WHERE id = ? AND card IS NOT NULL").run(JSON.stringify(actions), id);
  },
  setApproval(id: string, approval: SprocketApproval): void {
    db.prepare("UPDATE sprocket_messages SET approval = ? WHERE id = ?").run(JSON.stringify(approval), id);
  },
  /** Mark an event the Coordinator decided the user needn't hear about. */
  setQuiet(id: string): void {
    db.prepare("UPDATE sprocket_messages SET event = json_set(event, '$.quiet', json('true')) WHERE id = ? AND event IS NOT NULL").run(id);
  },
  /** An automation's run found nothing new (ADR 0032): its line isn't shown. */
  setAutomationQuiet(id: string): void {
    db.prepare("UPDATE sprocket_messages SET automation = json_set(automation, '$.quiet', json('true')) WHERE id = ? AND automation IS NOT NULL").run(id);
  },
  /** The stored tool steps of a Sprocket's `limit` latest replies in a chat that have them, by message id. */
  recentSteps(chatId: string, sprocketId: string, limit: number): Map<string, unknown[]> {
    const rows = db
      .prepare("SELECT id, steps FROM sprocket_messages WHERE chat_id = ? AND sprocket_id = ? AND steps IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(chatId, sprocketId, limit) as { id: string; steps: string }[];
    return new Map(rows.map((r) => [r.id, JSON.parse(r.steps)]));
  },
};

export type RunStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
/** `approval`: the user allowed or denied an MCP call the Sprocket asked for (ADR 0025). */
export type RunTrigger = "user" | "pass" | "event" | "approval" | "actions" | "automation";
type RunRow = {
  id: string;
  chat_id: string;
  sprocket_id: string;
  status: RunStatus;
  trigger: RunTrigger;
  source_id: string | null;
  from_id: string | null;
  hop: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};
/** A run (ADR 0023): one Sprocket's turn in one chat. */
export type StoredRun = { id: string; chatId: string; sprocketId: string; status: RunStatus; trigger: RunTrigger; sourceId?: string; from?: string; hop: number; error?: string; createdAt: string };
const toRun = (r: RunRow): StoredRun => ({
  id: r.id,
  chatId: r.chat_id,
  sprocketId: r.sprocket_id,
  status: r.status,
  trigger: r.trigger,
  ...(r.source_id ? { sourceId: r.source_id } : {}),
  ...(r.from_id ? { from: r.from_id } : {}),
  hop: r.hop,
  ...(r.error ? { error: r.error } : {}),
  createdAt: r.created_at,
});

export const sprocketRuns = {
  create(r: { chatId: string; sprocketId: string; trigger: RunTrigger; sourceId?: string; from?: string; hop?: number }): StoredRun {
    const id = randomUUID();
    db.prepare("INSERT INTO sprocket_runs (id, chat_id, sprocket_id, status, trigger, source_id, from_id, hop, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)").run(
      id,
      r.chatId,
      r.sprocketId,
      r.trigger,
      r.sourceId ?? null,
      r.from ?? null,
      r.hop ?? 0,
      new Date().toISOString(),
    );
    return this.get(id)!;
  },
  get(id: string): StoredRun | undefined {
    const r = db.prepare("SELECT * FROM sprocket_runs WHERE id = ?").get(id) as RunRow | undefined;
    return r && toRun(r);
  },
  /** Runs with one of `statuses`, oldest first; in one chat with `chatId`. */
  list(statuses: RunStatus[], chatId?: string): StoredRun[] {
    const marks = statuses.map(() => "?").join(", ");
    const rows = chatId
      ? db.prepare(`SELECT * FROM sprocket_runs WHERE status IN (${marks}) AND chat_id = ? ORDER BY created_at, rowid`).all(...statuses, chatId)
      : db.prepare(`SELECT * FROM sprocket_runs WHERE status IN (${marks}) ORDER BY created_at, rowid`).all(...statuses);
    return (rows as RunRow[]).map(toRun);
  },
  /** When a Sprocket's latest earlier run in a chat (not `exceptId`) that answered started (failed and cancelled ones didn't answer). */
  lastStart(chatId: string, sprocketId: string, exceptId: string): string | undefined {
    const r = db
      .prepare(
        "SELECT started_at FROM sprocket_runs WHERE chat_id = ? AND sprocket_id = ? AND id != ? AND started_at IS NOT NULL AND status IN ('done', 'waiting', 'running') ORDER BY started_at DESC LIMIT 1",
      )
      .get(chatId, sprocketId, exceptId) as { started_at: string } | undefined;
    return r?.started_at;
  },
  setStatus(id: string, status: RunStatus, error?: string): void {
    const now = new Date().toISOString();
    if (status === "running") db.prepare("UPDATE sprocket_runs SET status = ?, started_at = ? WHERE id = ?").run(status, now, id);
    else if (status === "queued" || status === "waiting") db.prepare("UPDATE sprocket_runs SET status = ? WHERE id = ?").run(status, id);
    else db.prepare("UPDATE sprocket_runs SET status = ?, error = ?, ended_at = ? WHERE id = ?").run(status, error ?? null, now, id);
  },
  /** End a chat's runs with one of `statuses` (cancelled). Returns how many. */
  cancel(chatId: string, statuses: RunStatus[]): number {
    const marks = statuses.map(() => "?").join(", ");
    return Number(
      db.prepare(`UPDATE sprocket_runs SET status = 'cancelled', ended_at = ? WHERE chat_id = ? AND status IN (${marks})`).run(new Date().toISOString(), chatId, ...statuses).changes,
    );
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
  dialog: string | null;
  queued: number;
  unconfirmed: number;
  edited: number;
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
  ...(r.dialog ? { dialog: JSON.parse(r.dialog) as NonNullable<Suggestion["dialog"]> } : {}),
  status: r.status,
  ...(r.error ? { error: r.error } : {}),
  ...(r.queued ? { queued: true } : {}),
  ...(r.unconfirmed ? { unconfirmed: true } : {}),
  ...(r.edited ? { edited: true } : {}),
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
    dialog?: Suggestion["dialog"];
  }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO suggestions (id, sprocket_id, panel_id, kind, title, session_id, mode, text, rule, attachment, sender, dialog, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
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
      s.dialog ? JSON.stringify(s.dialog) : null,
      now,
      now,
    );
    return this.get(id)!;
  },
  get(id: string) {
    const r = db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id) as SuggestionRow | undefined;
    return r && toSuggestion(r);
  },
  /** The suggestions shown in a chat (those whose reply was saved), by reply. */
  byMessage(chatId: string): Map<string, Suggestion[]> {
    const rows = db
      .prepare("SELECT s.* FROM suggestions s JOIN sprocket_messages m ON m.id = s.message_id WHERE m.chat_id = ? ORDER BY s.created_at, s.rowid")
      .all(chatId) as SuggestionRow[];
    const map = new Map<string, Suggestion[]>();
    for (const r of rows) {
      const { sprocketId: _s, messageId: _m, ...s } = toSuggestion(r);
      map.set(r.message_id!, [...(map.get(r.message_id!) ?? []), s]);
    }
    return map;
  },
  /** Under a chat's replies: the ones that still wait (to expire when it's cleared), or how many wait for the user. */
  waitingIn(chatId: string): string[] {
    return (
      db
        .prepare("SELECT s.id FROM suggestions s JOIN sprocket_messages m ON m.id = s.message_id WHERE m.chat_id = ? AND s.status IN ('pending', 'failed')")
        .all(chatId) as { id: string }[]
    ).map((r) => r.id);
  },
  pendingIn(chatId: string): number {
    const r = db.prepare("SELECT count(*) AS n FROM suggestions s JOIN sprocket_messages m ON m.id = s.message_id WHERE m.chat_id = ? AND s.status = 'pending'").get(chatId) as { n: number };
    return Number(r.n);
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
  /** The messages a session drafted for others since `since` (ADR 0018), newest first, without replaced ones. */
  byAgent(panelId: string, since: string) {
    return (
      db
        .prepare("SELECT * FROM suggestions WHERE json_extract(sender, '$.panelId') = ? AND created_at >= ? AND status != 'replaced' ORDER BY created_at DESC, rowid DESC")
        .all(panelId, since) as SuggestionRow[]
    ).map(toSuggestion);
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
  /** Mark a sent one as not yet taken by its session, or (false) as taken. True when that changed it. */
  setUnconfirmed(id: string, on: boolean): boolean {
    return db.prepare("UPDATE suggestions SET unconfirmed = ? WHERE id = ? AND status = 'sent' AND unconfirmed != ?").run(on ? 1 : 0, id, on ? 1 : 0).changes > 0;
  },
  /** Change the status if it's one of `from`. False when it wasn't (someone else changed it first). Once edited, it stays edited. */
  setStatus(id: string, from: Suggestion["status"][], to: Suggestion["status"], extra: { error?: string; text?: string; queued?: boolean; edited?: boolean } = {}): boolean {
    const marks = from.map(() => "?").join(", ");
    const r = db
      .prepare(`UPDATE suggestions SET status = ?, error = ?, text = COALESCE(?, text), queued = ?, edited = MAX(edited, ?), updated_at = ? WHERE id = ? AND status IN (${marks})`)
      .run(to, extra.error ?? null, extra.text ?? null, extra.queued ? 1 : 0, extra.edited ? 1 : 0, new Date().toISOString(), id, ...from);
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
/** The names the user gave sessions in Rails. */
export const sessionNames = {
  get(provider: string, sessionId: string): string | undefined {
    return (db.prepare("SELECT name FROM session_names WHERE provider = ? AND session_id = ?").get(provider, sessionId) as { name: string } | undefined)?.name;
  },
  set(provider: string, sessionId: string, name: string): void {
    db.prepare("INSERT INTO session_names (provider, session_id, name, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (provider, session_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at").run(
      provider,
      sessionId,
      name,
      new Date().toISOString(),
    );
  },
  clear(provider: string, sessionId: string): void {
    db.prepare("DELETE FROM session_names WHERE provider = ? AND session_id = ?").run(provider, sessionId);
  },
};

export const owners = {
  list(projectId: string): { panelId: string; path: string }[] {
    return (db.prepare("SELECT panel_id, path FROM owners WHERE project_id = ? ORDER BY created_at, rowid").all(projectId) as { panel_id: string; path: string }[]).map(
      (r) => ({ panelId: r.panel_id, path: r.path }),
    );
  },
  /** Replace what a panel owns. */
  set(projectId: string, panelId: string, paths: string[]): void {
    const now = new Date().toISOString();
    tx(() => {
      db.prepare("DELETE FROM owners WHERE panel_id = ?").run(panelId);
      for (const p of paths) db.prepare("INSERT INTO owners (panel_id, project_id, path, created_at) VALUES (?, ?, ?, ?)").run(panelId, projectId, p, now);
    });
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

type PromptRow = { id: string; name: string; text: string; created_at: string };
const toPrompt = (r: PromptRow): SavedPrompt => ({ id: r.id, name: r.name, text: r.text, createdAt: r.created_at });

export const savedPrompts = {
  list(): SavedPrompt[] {
    return (db.prepare("SELECT * FROM saved_prompts ORDER BY name COLLATE NOCASE").all() as PromptRow[]).map(toPrompt);
  },
  get(id: string): SavedPrompt | undefined {
    const r = db.prepare("SELECT * FROM saved_prompts WHERE id = ?").get(id) as PromptRow | undefined;
    return r && toPrompt(r);
  },
  create(name: string, text: string): SavedPrompt {
    const id = randomUUID();
    db.prepare("INSERT INTO saved_prompts (id, name, text, created_at) VALUES (?, ?, ?, ?)").run(id, name, text, new Date().toISOString());
    return this.get(id)!;
  },
  update(id: string, name: string, text: string): void {
    db.prepare("UPDATE saved_prompts SET name = ?, text = ? WHERE id = ?").run(name, text, id);
  },
  remove(id: string): void {
    db.prepare("DELETE FROM saved_prompts WHERE id = ?").run(id);
  },
};

// ---- Customize (ADR 0025): MCP servers and what each Sprocket has ----

/** A tool as Rails last saw it on its server (its input schema too, for the capability). */
export type StoredTool = { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; destructive?: boolean };
export type StoredMcpServer = {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  tools: StoredTool[];
  toolsAt?: string;
  policies: Record<string, "allow" | "ask" | "off">;
  status: { state: "unknown" | "ok" | "error"; error?: string; at?: string };
  connector?: string;
  createdAt: string;
};
type McpRow = {
  id: string;
  name: string;
  description: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  url: string;
  tools: string;
  tools_at: string | null;
  policies: string;
  status: string | null;
  connector: string | null;
  created_at: string;
};
const toMcp = (r: McpRow): StoredMcpServer => ({
  id: r.id,
  name: r.name,
  description: r.description,
  transport: r.transport,
  command: r.command,
  args: JSON.parse(r.args),
  url: r.url,
  tools: JSON.parse(r.tools),
  ...(r.tools_at ? { toolsAt: r.tools_at } : {}),
  policies: JSON.parse(r.policies),
  status: r.status ? JSON.parse(r.status) : { state: "unknown" },
  ...(r.connector ? { connector: r.connector } : {}),
  createdAt: r.created_at,
});

export const mcpServers = {
  list(): StoredMcpServer[] {
    return (db.prepare("SELECT * FROM mcp_servers ORDER BY name").all() as McpRow[]).map(toMcp);
  },
  get(id: string): StoredMcpServer | undefined {
    const r = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpRow | undefined;
    return r && toMcp(r);
  },
  byName(name: string): StoredMcpServer | undefined {
    const r = db.prepare("SELECT * FROM mcp_servers WHERE name = ?").get(name) as McpRow | undefined;
    return r && toMcp(r);
  },
  create(s: Pick<StoredMcpServer, "name" | "description" | "transport" | "command" | "args" | "url" | "connector">): StoredMcpServer {
    const id = randomUUID();
    db.prepare("INSERT INTO mcp_servers (id, name, description, transport, command, args, url, connector, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      s.name,
      s.description,
      s.transport,
      s.command,
      JSON.stringify(s.args),
      s.url,
      s.connector ?? null,
      new Date().toISOString(),
    );
    return this.get(id)!;
  },
  update(id: string, s: Pick<StoredMcpServer, "name" | "description" | "transport" | "command" | "args" | "url" | "policies">): void {
    db.prepare("UPDATE mcp_servers SET name = ?, description = ?, transport = ?, command = ?, args = ?, url = ?, policies = ? WHERE id = ?").run(
      s.name,
      s.description,
      s.transport,
      s.command,
      JSON.stringify(s.args),
      s.url,
      JSON.stringify(s.policies),
      id,
    );
  },
  setTools(id: string, tools: StoredTool[]): void {
    db.prepare("UPDATE mcp_servers SET tools = ?, tools_at = ? WHERE id = ?").run(JSON.stringify(tools), new Date().toISOString(), id);
  },
  setStatus(id: string, status: StoredMcpServer["status"]): void {
    db.prepare("UPDATE mcp_servers SET status = ? WHERE id = ?").run(JSON.stringify(status), id);
  },
  remove(id: string): void {
    tx(() => {
      db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
      db.prepare("DELETE FROM sprocket_tools WHERE kind = 'mcp' AND item_id = ?").run(id);
    });
  },
};

/** What each Sprocket has (ADR 0025): MCP servers by id, skills by folder name. */
export const sprocketTools = {
  of(sprocketId: string): { mcp: string[]; skills: string[] } {
    const rows = db.prepare("SELECT kind, item_id FROM sprocket_tools WHERE sprocket_id = ? ORDER BY item_id").all(sprocketId) as { kind: string; item_id: string }[];
    return { mcp: rows.filter((r) => r.kind === "mcp").map((r) => r.item_id), skills: rows.filter((r) => r.kind === "skill").map((r) => r.item_id) };
  },
  /** The Sprockets that have this server or skill. */
  users(kind: "mcp" | "skill", itemId: string): string[] {
    return (db.prepare("SELECT sprocket_id FROM sprocket_tools WHERE kind = ? AND item_id = ?").all(kind, itemId) as { sprocket_id: string }[]).map((r) => r.sprocket_id);
  },
  set(sprocketId: string, kind: "mcp" | "skill", ids: string[]): void {
    tx(() => {
      db.prepare("DELETE FROM sprocket_tools WHERE sprocket_id = ? AND kind = ?").run(sprocketId, kind);
      for (const id of new Set(ids)) db.prepare("INSERT INTO sprocket_tools (sprocket_id, kind, item_id) VALUES (?, ?, ?)").run(sprocketId, kind, id);
    });
  },
  /** A skill is gone: no Sprocket has it any more. */
  dropSkill(id: string): void {
    db.prepare("DELETE FROM sprocket_tools WHERE kind = 'skill' AND item_id = ?").run(id);
  },
};

export interface StoredAutomation {
  id: string;
  name: string;
  sprocketId: string;
  prompt: string;
  schedule: AutomationSchedule;
  timezone: string;
  enabled: boolean;
  pausedReason?: string;
  nextRunAt?: string;
  createdAt: string;
}
type AutomationRow = {
  id: string;
  name: string;
  sprocket_id: string;
  prompt: string;
  schedule: string;
  timezone: string;
  enabled: number;
  paused_reason: string | null;
  next_run_at: string | null;
  created_at: string;
};
const toAutomation = (r: AutomationRow): StoredAutomation => ({
  id: r.id,
  name: r.name,
  sprocketId: r.sprocket_id,
  prompt: r.prompt,
  schedule: JSON.parse(r.schedule),
  timezone: r.timezone,
  enabled: !!r.enabled,
  ...(r.paused_reason ? { pausedReason: r.paused_reason } : {}),
  ...(r.next_run_at ? { nextRunAt: r.next_run_at } : {}),
  createdAt: r.created_at,
});

/** Automations (ADR 0032), oldest first. */
export const automations = {
  list(): StoredAutomation[] {
    return (db.prepare("SELECT * FROM automations ORDER BY created_at, rowid").all() as AutomationRow[]).map(toAutomation);
  },
  get(id: string): StoredAutomation | undefined {
    const r = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as AutomationRow | undefined;
    return r && toAutomation(r);
  },
  create(a: Omit<StoredAutomation, "id" | "createdAt" | "pausedReason">): StoredAutomation {
    const id = randomUUID();
    db.prepare("INSERT INTO automations (id, name, sprocket_id, prompt, schedule, timezone, enabled, next_run_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      a.name,
      a.sprocketId,
      a.prompt,
      JSON.stringify(a.schedule),
      a.timezone,
      a.enabled ? 1 : 0,
      a.nextRunAt ?? null,
      new Date().toISOString(),
    );
    return this.get(id)!;
  },
  /** Every field given is set; `pausedReason` and `nextRunAt` as given (undefined clears them). */
  update(id: string, a: Omit<StoredAutomation, "id" | "createdAt">): void {
    db.prepare("UPDATE automations SET name = ?, sprocket_id = ?, prompt = ?, schedule = ?, timezone = ?, enabled = ?, paused_reason = ?, next_run_at = ? WHERE id = ?").run(
      a.name,
      a.sprocketId,
      a.prompt,
      JSON.stringify(a.schedule),
      a.timezone,
      a.enabled ? 1 : 0,
      a.pausedReason ?? null,
      a.nextRunAt ?? null,
      id,
    );
  },
  remove(id: string): void {
    tx(() => {
      db.prepare("DELETE FROM automation_runs WHERE automation_id = ?").run(id);
      db.prepare("DELETE FROM automations WHERE id = ?").run(id);
    });
  },
};

type AutomationRunRow = {
  id: string;
  automation_id: string;
  sprocket_run_id: string | null;
  message_id: string | null;
  trigger: AutomationTrigger;
  outcome: AutomationOutcome;
  summary: string | null;
  created_at: string;
  ended_at: string | null;
};
export type StoredAutomationRun = AutomationRun & { sprocketRunId?: string; messageId?: string };
const toAutomationRun = (r: AutomationRunRow): StoredAutomationRun => ({
  id: r.id,
  automationId: r.automation_id,
  trigger: r.trigger,
  outcome: r.outcome,
  ...(r.summary ? { summary: r.summary } : {}),
  createdAt: r.created_at,
  ...(r.ended_at ? { endedAt: r.ended_at } : {}),
  ...(r.sprocket_run_id ? { sprocketRunId: r.sprocket_run_id } : {}),
  ...(r.message_id ? { messageId: r.message_id } : {}),
});

/** An automation's runs (ADR 0032). */
export const automationRuns = {
  create(r: { automationId: string; trigger: AutomationTrigger; outcome: AutomationOutcome; sprocketRunId?: string; messageId?: string; summary?: string }): StoredAutomationRun {
    const id = randomUUID();
    const now = new Date().toISOString();
    const ended = r.outcome === "running" ? null : now;
    db.prepare("INSERT INTO automation_runs (id, automation_id, sprocket_run_id, message_id, trigger, outcome, summary, created_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      r.automationId,
      r.sprocketRunId ?? null,
      r.messageId ?? null,
      r.trigger,
      r.outcome,
      r.summary ?? null,
      now,
      ended,
    );
    return this.get(id)!;
  },
  get(id: string): StoredAutomationRun | undefined {
    const r = db.prepare("SELECT * FROM automation_runs WHERE id = ?").get(id) as AutomationRunRow | undefined;
    return r && toAutomationRun(r);
  },
  /** An automation's runs, newest first. */
  list(automationId: string, limit = 50): StoredAutomationRun[] {
    return (db.prepare("SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(automationId, limit) as AutomationRunRow[]).map(toAutomationRun);
  },
  /** How its runs went: started, ended and failed counts, and how long an ended one took on average. */
  stats(automationId: string): { runs: number; ended: number; failed: number; avgMs?: number } {
    const r = db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE outcome != 'skipped') AS runs,
                COUNT(*) FILTER (WHERE outcome NOT IN ('skipped', 'running')) AS ended,
                COUNT(*) FILTER (WHERE outcome = 'failed') AS failed,
                AVG((julianday(ended_at) - julianday(created_at)) * 86400000) FILTER (WHERE outcome NOT IN ('skipped', 'running') AND ended_at IS NOT NULL) AS avg_ms
           FROM automation_runs WHERE automation_id = ?`,
      )
      .get(automationId) as { runs: number; ended: number; failed: number; avg_ms: number | null };
    return { runs: r.runs, ended: r.ended, failed: r.failed, ...(r.avg_ms != null ? { avgMs: Math.round(r.avg_ms) } : {}) };
  },
  /** Runs still going, across automations. */
  running(): StoredAutomationRun[] {
    return (db.prepare("SELECT * FROM automation_runs WHERE outcome = 'running' ORDER BY created_at").all() as AutomationRunRow[]).map(toAutomationRun);
  },
  end(id: string, outcome: AutomationOutcome, summary?: string): void {
    db.prepare("UPDATE automation_runs SET outcome = ?, summary = COALESCE(?, summary), ended_at = ? WHERE id = ?").run(outcome, summary ?? null, new Date().toISOString(), id);
  },
  /** A run that found nothing new says so itself (nothing_new), before it ends. */
  setQuiet(sprocketRunId: string, summary: string): void {
    db.prepare("UPDATE automation_runs SET outcome = 'quiet', summary = ?, ended_at = ? WHERE sprocket_run_id = ? AND outcome = 'running'").run(summary, new Date().toISOString(), sprocketRunId);
  },
};

