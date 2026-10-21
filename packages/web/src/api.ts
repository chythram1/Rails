import type {
  AgentProfile,
  AgentProfileInput,
  DecisionLog,
  FolderListing,
  GitStatus,
  ModelSettings,
  OpenPanel,
  Panel,
  Profile,
  ProfileChange,
  Project,
  ProviderInfo,
  ProfileUse,
  RecentFolder,
  SavedPrompt,
  SavedPromptInput,
  ServerInfo,
  SessionKey,
  SessionSummary,
  SignIn,
  SkillInfo,
  Sprocket,
  SprocketInput,
  SprocketMessage,
  SprocketSettings,
  Suggestion,
  Workspace,
} from "@rails/shared";

export class Unauthorized extends Error {}

let signedOut = () => {};
/** Called whenever the server says this browser isn't signed in, e.g. after "Sign out everywhere". */
export const onSignedOut = (fn: () => void) => void (signedOut = fn);

const UNREACHABLE = "Can't reach the Rails server. Check that it's running (make dev).";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new Error(UNREACHABLE); // fetch only rejects on network failure
  }
  if (res.status === 502) throw new Error(UNREACHABLE); // Vite dev proxy: API server is down
  if (res.status === 401) {
    signedOut();
    throw new Unauthorized();
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body as any)?.error ?? res.statusText);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  login: (token: string) => req<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ token }) }),
  me: () => req<{ ok: true }>("/api/auth/me"),
  /** Signs this browser out and tells the app (which shows the sign-in screen). */
  logout: async () => {
    await req<{ ok: true }>("/api/auth/logout", { method: "POST" });
    signedOut();
  },
  server: () => req<ServerInfo>("/api/server"),
  /** The profile itself arrives over the socket (profile.changed), on connect and on every change. */
  updateProfile: (change: ProfileChange) => req<Profile>("/api/profile", { method: "PUT", body: JSON.stringify(change) }),
  /** Replaces the access token (every other device is signed out) and returns the new one. */
  signOutEverywhere: () => req<{ token: string }>("/api/account/sign-out-everywhere", { method: "POST" }),
  providers: () => req<ProviderInfo[]>("/api/providers"),
  projects: () => req<Project[]>("/api/projects"),
  addProject: (path: string) => req<Project>("/api/projects", { method: "POST", body: JSON.stringify({ path }) }),
  recentFolders: () => req<RecentFolder[]>("/api/recent-folders"),
  /** Opens the native folder picker on the server; null project means the user cancelled. */
  pickProject: () => req<{ project: Project | null }>("/api/projects/pick", { method: "POST" }),
  removeProject: (id: string) => req("/api/projects/" + enc(id), { method: "DELETE" }),
  sessions: (projectId: string) => req<SessionSummary[]>(`/api/projects/${enc(projectId)}/sessions`),
  /** Name a session in Rails; an empty name clears it (names.ts). */
  nameSession: (projectId: string, key: SessionKey, name: string) =>
    req<{ title: string }>(`/api/projects/${enc(projectId)}/sessions/${enc(key)}/name`, { method: "PUT", body: JSON.stringify({ name }) }),
  workspace: (projectId: string) => req<Workspace>(`/api/projects/${enc(projectId)}/workspace`),
  openPanel: (projectId: string, body: OpenPanel) =>
    req<Panel>(`/api/projects/${enc(projectId)}/panels`, { method: "POST", body: JSON.stringify(body) }),
  closePanel: (id: string) => req("/api/panels/" + enc(id), { method: "DELETE" }),
  saveLayout: (projectId: string, layout: unknown) =>
    req(`/api/projects/${enc(projectId)}/layout`, { method: "PUT", body: JSON.stringify({ layout }) }),
  git: (projectId: string) => req<GitStatus>(`/api/projects/${enc(projectId)}/git`),
  files: (projectId: string, dir: string) => req<FolderListing>(`/api/projects/${enc(projectId)}/files?dir=${enc(dir)}`),
  fileText: (projectId: string, path: string) => req<{ text: string; cut: boolean }>(`/api/projects/${enc(projectId)}/files/content?path=${enc(path)}`),
  diff: (projectId: string, path: string) => req<string>(`/api/projects/${enc(projectId)}/git/diff?path=${enc(path)}`),
  sprockets: () => req<Sprocket[]>("/api/sprockets"),
  createSprocket: (body: SprocketInput) => req<Sprocket>("/api/sprockets", { method: "POST", body: JSON.stringify(body) }),
  updateSprocket: (id: string, body: SprocketInput) => req<Sprocket>("/api/sprockets/" + enc(id), { method: "PUT", body: JSON.stringify(body) }),
  deleteSprocket: (id: string) => req("/api/sprockets/" + enc(id), { method: "DELETE" }),
  sprocketMessages: (id: string) => req<SprocketMessage[]>(`/api/sprockets/${enc(id)}/messages`),
  sendSprocketMessage: (id: string, text: string) =>
    req<SprocketMessage>(`/api/sprockets/${enc(id)}/messages`, { method: "POST", body: JSON.stringify({ text }) }),
  sprocketSettings: (id: string, body: SprocketSettings) =>
    req<Sprocket>(`/api/sprockets/${enc(id)}/settings`, { method: "PUT", body: JSON.stringify(body) }),
  sendSuggestion: (id: string, text: string) => req<Suggestion>(`/api/suggestions/${enc(id)}/send`, { method: "POST", body: JSON.stringify({ text }) }),
  dismissSuggestion: (id: string) => req<Suggestion>(`/api/suggestions/${enc(id)}/dismiss`, { method: "POST" }),
  cancelHandoff: (id: string) => req<{ ok: true }>(`/api/handoffs/${enc(id)}/cancel`, { method: "POST" }),
  clearOwner: (panelId: string) => req<{ ok: true }>(`/api/owners/${enc(panelId)}`, { method: "DELETE" }),
  agentProfiles: () => req<AgentProfile[]>("/api/agent-profiles"),
  createAgentProfile: (body: Partial<AgentProfileInput> = {}) => req<AgentProfile>("/api/agent-profiles", { method: "POST", body: JSON.stringify(body) }),
  updateAgentProfile: (id: string, body: Partial<AgentProfileInput>) =>
    req<AgentProfile>("/api/agent-profiles/" + enc(id), { method: "PUT", body: JSON.stringify(body) }),
  deleteAgentProfile: (id: string) => req("/api/agent-profiles/" + enc(id), { method: "DELETE" }),
  /** The running panels that started with this profile. */
  profileUses: (id: string) => req<ProfileUse[]>(`/api/agent-profiles/${enc(id)}/panels`),
  prompts: () => req<SavedPrompt[]>("/api/prompts"),
  createPrompt: (body: SavedPromptInput = {}) => req<SavedPrompt>("/api/prompts", { method: "POST", body: JSON.stringify(body) }),
  updatePrompt: (id: string, body: SavedPromptInput) => req<SavedPrompt>("/api/prompts/" + enc(id), { method: "PUT", body: JSON.stringify(body) }),
  deletePrompt: (id: string) => req("/api/prompts/" + enc(id), { method: "DELETE" }),
  skills: () => req<SkillInfo[]>("/api/skills"),
  /** Opens the native folder picker on the server; null skill means the user cancelled. */
  importSkill: () => req<{ skill: SkillInfo | null }>("/api/skills/import", { method: "POST" }),
  models: () => req<ModelSettings>("/api/models"),
  setDefaultModel: (model: string | null) => req("/api/models/default", { method: "PUT", body: JSON.stringify({ model }) }),
  setDecisionModel: (model: string | null) => req("/api/models/decisions", { method: "PUT", body: JSON.stringify({ model }) }),
  setDecisionThreshold: (threshold: number) => req("/api/models/decisions/threshold", { method: "PUT", body: JSON.stringify({ threshold }) }),
  decisions: () => req<DecisionLog>("/api/decisions"),
  /** Saves a key the provider accepted; `note` when it couldn't be checked. Refused keys come back as errors. */
  setProviderKey: (id: string, key: string) => req<{ note?: string }>(`/api/models/providers/${enc(id)}/key`, { method: "PUT", body: JSON.stringify({ key }) }),
  removeProvider: (id: string) => req(`/api/models/providers/${enc(id)}`, { method: "DELETE" }),
  startSignIn: (id: string, fresh = false) =>
    req<SignIn>(`/api/models/providers/${enc(id)}/sign-in`, { method: "POST", body: JSON.stringify({ fresh }) }),
  submitSignInCode: (id: string, code: string) => req(`/api/models/sign-ins/${enc(id)}/code`, { method: "POST", body: JSON.stringify({ code }) }),
  cancelSignIn: (id: string) => req(`/api/models/sign-ins/${enc(id)}`, { method: "DELETE" }),
};
