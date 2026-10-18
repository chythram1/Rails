import type {
  GitStatus,
  ModelSettings,
  OpenPanel,
  Panel,
  Project,
  ProviderInfo,
  RecentFolder,
  SessionSummary,
  SignIn,
  Sprocket,
  SprocketInput,
  SprocketMessage,
  SprocketSettings,
  Workspace,
} from "@rails/shared";

export class Unauthorized extends Error {}

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
  if (res.status === 401) throw new Unauthorized();
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body as any)?.error ?? res.statusText);
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  login: (token: string) => req<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ token }) }),
  me: () => req<{ ok: true }>("/api/auth/me"),
  providers: () => req<ProviderInfo[]>("/api/providers"),
  projects: () => req<Project[]>("/api/projects"),
  addProject: (path: string) => req<Project>("/api/projects", { method: "POST", body: JSON.stringify({ path }) }),
  recentFolders: () => req<RecentFolder[]>("/api/recent-folders"),
  /** Opens the native folder picker on the server; null project means the user cancelled. */
  pickProject: () => req<{ project: Project | null }>("/api/projects/pick", { method: "POST" }),
  removeProject: (id: string) => req("/api/projects/" + enc(id), { method: "DELETE" }),
  sessions: (projectId: string) => req<SessionSummary[]>(`/api/projects/${enc(projectId)}/sessions`),
  workspace: (projectId: string) => req<Workspace>(`/api/projects/${enc(projectId)}/workspace`),
  openPanel: (projectId: string, body: OpenPanel) =>
    req<Panel>(`/api/projects/${enc(projectId)}/panels`, { method: "POST", body: JSON.stringify(body) }),
  closePanel: (id: string) => req("/api/panels/" + enc(id), { method: "DELETE" }),
  saveLayout: (projectId: string, layout: unknown) =>
    req(`/api/projects/${enc(projectId)}/layout`, { method: "PUT", body: JSON.stringify({ layout }) }),
  git: (projectId: string) => req<GitStatus>(`/api/projects/${enc(projectId)}/git`),
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
  models: () => req<ModelSettings>("/api/models"),
  setDefaultModel: (model: string | null) => req("/api/models/default", { method: "PUT", body: JSON.stringify({ model }) }),
  setProviderKey: (id: string, key: string) => req(`/api/models/providers/${enc(id)}/key`, { method: "PUT", body: JSON.stringify({ key }) }),
  removeProvider: (id: string) => req(`/api/models/providers/${enc(id)}`, { method: "DELETE" }),
  startSignIn: (id: string, fresh = false) =>
    req<SignIn>(`/api/models/providers/${enc(id)}/sign-in`, { method: "POST", body: JSON.stringify({ fresh }) }),
  submitSignInCode: (id: string, code: string) => req(`/api/models/sign-ins/${enc(id)}/code`, { method: "POST", body: JSON.stringify({ code }) }),
  cancelSignIn: (id: string) => req(`/api/models/sign-ins/${enc(id)}`, { method: "DELETE" }),
};
