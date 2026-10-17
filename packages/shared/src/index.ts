// Shared domain + wire types. Terms are defined in docs/CONTEXT.md.

export type ProviderId = "claude" | "codex" | "pi";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Provider store exists on disk (sessions can be discovered). */
  discoverable: boolean;
  /** The provider's CLI is on the server's PATH, so panels can run it. */
  installed: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

/** A folder where agents have sessions and that isn't a project yet, offered when adding a project. */
export interface RecentFolder {
  path: string;
  /** The folder's own name (UI shows names, not paths). */
  name: string;
  lastActive: string;
}

/** `${provider}:${providerSessionId}` */
export type SessionKey = string;
export const sessionKey = (provider: ProviderId, id: string): SessionKey => `${provider}:${id}`;
export function parseSessionKey(key: SessionKey): { provider: ProviderId; id: string } {
  const i = key.indexOf(":");
  return { provider: key.slice(0, i) as ProviderId, id: key.slice(i + 1) };
}

export interface SessionSummary {
  key: SessionKey;
  provider: ProviderId;
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Id of the panel this session is open in, if any. */
  panelId?: string;
}

/** What runs in a panel: one of the agents' native TUIs, or a plain shell in the project folder. */
export type PanelKind = ProviderId | "shell";

/** A terminal tab in a project's workspace. Its process runs in tmux, so it survives server restarts. */
export interface Panel {
  id: string;
  projectId: string;
  kind: PanelKind;
  /** Provider session shown in this panel. Unknown for shells and for new Codex sessions. */
  sessionId?: string;
  title: string;
  createdAt: string;
}

/** Body of "open a panel" (POST /api/projects/:id/panels). */
export interface OpenPanel {
  kind: PanelKind;
  /** Resume this existing session instead of starting a new one. */
  sessionId?: string;
  /** First message for a new agent session. */
  prompt?: string;
}

/** A project's panels plus the saved dockview layout (opaque to the server). */
export interface Workspace {
  panels: Panel[];
  layout: unknown | null;
}

export interface GitFile {
  path: string;
  /** Two-letter porcelain XY code, e.g. " M", "A ", "??". */
  status: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  files: GitFile[];
}

// ---- Sprockets: always-on agents (ADR 0005). Stage 1 is their look and chat UI only. ----

/** The cast: the shapes a Sprocket can have. */
export const SPROCKET_CHARACTERS = ["block", "bean", "lune", "bell", "starry", "cog", "roo", "momo"] as const;
export type SprocketCharacter = (typeof SPROCKET_CHARACTERS)[number];

/** Body colours (the web holds the hex values). */
export const SPROCKET_COLORS = ["brown", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "grey"] as const;
export type SprocketColor = (typeof SPROCKET_COLORS)[number];

/** Head accessories; a Sprocket wears one or none. */
export const SPROCKET_ACCESSORIES = ["party", "beanie", "cap", "bow", "flower", "crown", "bucket"] as const;
export type SprocketAccessory = (typeof SPROCKET_ACCESSORIES)[number];

/** What a Sprocket looks like. */
export interface SprocketLook {
  character: SprocketCharacter;
  color: SprocketColor;
  accessory: SprocketAccessory | "none";
}

export interface Sprocket {
  id: string;
  name: string;
  look: SprocketLook;
  createdAt: string;
  /** The newest message in its chat, for the list preview. */
  lastMessage?: SprocketMessage;
}

/** Body of "create a Sprocket" and "edit a Sprocket". */
export interface SprocketInput {
  name: string;
  look: SprocketLook;
}

/** A message the user sent to a Sprocket. Sprockets can't reply yet, so every message is the user's. */
export interface SprocketMessage {
  id: string;
  sprocketId: string;
  text: string;
  createdAt: string;
}

// ---- WebSocket protocol ----------------------------------------------------
// Each attached panel gets its own tmux client on the server, sized to that browser's terminal.

export type ClientMsg =
  /** `attachId` is unique per attach; output is tagged with it so a terminal can ignore a previous attach's. */
  | { type: "term.attach"; panelId: string; attachId: number; cols: number; rows: number }
  | { type: "term.detach"; panelId: string }
  | { type: "term.input"; panelId: string; data: string }
  | { type: "term.resize"; panelId: string; cols: number; rows: number };

export type ServerMsg =
  | { type: "term.data"; panelId: string; attachId: number; data: string }
  /** A project's panels changed: opened, closed, or ended on their own (possibly on another device). */
  | { type: "panels.changed"; projectId: string }
  /** Every busy panel (its agent is thinking or replying), across all projects. Sent on connect and on change. */
  | { type: "panels.busy"; panelIds: string[] }
  /** Sprockets or their messages changed (possibly on another device). */
  | { type: "sprockets.changed" }
  | { type: "error"; message: string };
