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

/** Why a panel needs the user (ADR 0007): its agent waits for a permission or an answer, or its turn failed. */
export type AttentionReason = "waiting" | "failed";

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

// ---- Sprockets: always-on agents (ADR 0005, 0006). ----

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
  /** The project it's attached to; a Sprocket belongs to at most one project. */
  projectId?: string;
  /** The model it runs on (`provider/model`), or none to use the default model. */
  model?: string;
  /** Its core memory: a short sheet that stays with it, even when it moves to another project. */
  coreMemory: string;
  /** True while it's working on a reply. */
  running: boolean;
  /** The newest message in its chat, for the list preview. */
  lastMessage?: SprocketMessage;
}

/** Core memory is kept short on purpose (a frozen snapshot loaded into every run). */
export const CORE_MEMORY_MAX = 1500;

/** Body of "change a Sprocket's settings". Only the fields present change; null clears. */
export interface SprocketSettings {
  projectId?: string | null;
  model?: string | null;
  coreMemory?: string;
}

/** Body of "create a Sprocket" and "edit a Sprocket". */
export interface SprocketInput {
  name: string;
  look: SprocketLook;
}

/** Who wrote a chat message: the user, the Sprocket, or rails itself (setup hints and errors). */
export type SprocketAuthor = "user" | "sprocket" | "notice";

/** One message in a Sprocket's chat. */
export interface SprocketMessage {
  id: string;
  sprocketId: string;
  author: SprocketAuthor;
  text: string;
  createdAt: string;
}

// ---- Settings ----

/** Facts about the Rails server, for Settings → General. */
export interface ServerInfo {
  /** The address the server listens on (RAILS_HOST) and its port. */
  host: string;
  port: number;
  /** True when other devices can reach it (it listens beyond localhost). */
  network: boolean;
  /** The commit it runs, when it runs from a git checkout. */
  build?: string;
  tmux?: string;
  node: string;
  /** The access token is set with RAILS_TOKEN, so Rails can't replace it. */
  tokenFromEnv: boolean;
}

// ---- Models: what Sprockets run on (ADR 0006). ----

/** A model provider rails can bill Sprockets to, and how it's set up. */
export interface ModelProvider {
  id: string;
  name: string;
  /** How it's set up, or null if it isn't. */
  auth: null | { type: "api_key" | "oauth" };
  /** Label of its sign-in button, for providers that support signing in (e.g. "Continue with ChatGPT"). */
  signIn?: string;
}

/** A model a Sprocket can run on. `ref` is `provider/model`. */
export interface ModelChoice {
  ref: string;
  provider: string;
  name: string;
}

export interface ModelSettings {
  providers: ModelProvider[];
  /** Models of the providers that are set up. */
  models: ModelChoice[];
  /** Used by Sprockets that don't pick their own model. */
  defaultModel?: string;
}

/** A sign-in with a provider in progress. It runs on the server; the browser opens `authUrl`. */
export interface SignIn {
  id: string;
  providerId: string;
  state: "waiting" | "done" | "failed" | "cancelled";
  authUrl?: string;
  /** Signing in again to the account this install signed in to before (no naming or consent screens). */
  sameAccount?: boolean;
  /** Why it failed. */
  error?: string;
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
  /** Every panel that needs the user, across all projects. Sent on connect and on change. */
  | { type: "panels.attention"; panels: { panelId: string; reason: AttentionReason }[] }
  /** Sprockets or their messages changed (possibly on another device). */
  | { type: "sprockets.changed" }
  /** A Sprocket's reply so far, while it's being written; null when it's done. */
  | { type: "sprockets.typing"; sprocketId: string; text: string | null }
  /** Providers, sign-ins or the default model changed. */
  | { type: "models.changed" }
  | { type: "models.signIn"; signIn: SignIn }
  | { type: "error"; message: string };
