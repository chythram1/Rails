// Shared domain + wire types. Terms are defined in docs/CONTEXT.md.

export type ProviderId = "claude" | "codex" | "pi";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Provider store exists on disk (sessions can be discovered). */
  discoverable: boolean;
  /** rails can start / resume live sessions for this provider. */
  live: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface ProjectSuggestion {
  path: string;
  providers: ProviderId[];
  sessionCount: number;
  lastActive: string;
}

/** `${provider}:${providerSessionId}` */
export type SessionKey = string;
export const sessionKey = (provider: ProviderId, id: string): SessionKey => `${provider}:${id}`;
export function parseSessionKey(key: SessionKey): { provider: ProviderId; id: string } {
  const i = key.indexOf(":");
  return { provider: key.slice(0, i) as ProviderId, id: key.slice(i + 1) };
}

export type LiveStatus = "starting" | "running" | "idle" | "error" | "stopped";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface SessionSummary {
  key: SessionKey;
  provider: ProviderId;
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Present when the rails server currently owns a live process for this session. */
  liveStatus?: LiveStatus;
}

/** Normalized conversation unit; every adapter maps its native format to this. */
export type Message =
  | { kind: "user"; id: string; text: string; ts?: string }
  | { kind: "assistant"; id: string; text: string; ts?: string }
  | { kind: "thinking"; id: string; text: string; ts?: string }
  | { kind: "tool_use"; id: string; toolUseId: string; name: string; input: unknown; ts?: string }
  | { kind: "tool_result"; id: string; toolUseId: string; output: string; isError: boolean; ts?: string }
  | { kind: "system"; id: string; text: string; ts?: string };

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: unknown;
  createdAt: string;
}

export interface LiveSessionInfo {
  key: SessionKey;
  projectId: string;
  status: LiveStatus;
  mode: PermissionMode;
  pending: number;
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

// ---- WebSocket protocol ----------------------------------------------------

export type ClientMsg =
  | { type: "subscribe"; key: SessionKey }
  | { type: "unsubscribe"; key: SessionKey }
  /** Start a brand-new session. `clientRef` correlates the `session.started` reply. */
  | { type: "start"; clientRef: string; projectId: string; provider: ProviderId; text: string; mode?: PermissionMode }
  /** Send to an existing session; resumes it if it isn't live. */
  | { type: "send"; key: SessionKey; projectId: string; text: string; mode?: PermissionMode }
  | { type: "permission"; key: SessionKey; requestId: string; allow: boolean }
  | { type: "interrupt"; key: SessionKey }
  | { type: "stop"; key: SessionKey }
  | { type: "setMode"; key: SessionKey; mode: PermissionMode };

export type ServerMsg =
  | { type: "snapshot"; key: SessionKey; status: LiveStatus; mode: PermissionMode; messages: Message[]; pending: PermissionRequest[] }
  | { type: "message"; key: SessionKey; message: Message }
  | { type: "status"; key: SessionKey; status: LiveStatus; error?: string }
  | { type: "mode"; key: SessionKey; mode: PermissionMode }
  | { type: "permission.request"; key: SessionKey; request: PermissionRequest }
  | { type: "permission.resolved"; key: SessionKey; requestId: string; allow: boolean }
  | { type: "session.started"; clientRef: string; key: SessionKey; projectId: string }
  | { type: "live"; sessions: LiveSessionInfo[] }
  | { type: "error"; message: string; clientRef?: string };
