import type { GitStatus, Message, Project, ProjectSuggestion, ProviderInfo, SessionSummary } from "@rails/shared";

export class Unauthorized extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
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
  removeProject: (id: string) => req("/api/projects/" + enc(id), { method: "DELETE" }),
  suggestions: () => req<ProjectSuggestion[]>("/api/project-suggestions"),
  sessions: (projectId: string) => req<SessionSummary[]>(`/api/projects/${enc(projectId)}/sessions`),
  messages: (provider: string, id: string) => req<Message[]>(`/api/sessions/${enc(provider)}/${enc(id)}/messages`),
  git: (projectId: string) => req<GitStatus>(`/api/projects/${enc(projectId)}/git`),
  diff: (projectId: string, path: string) => req<string>(`/api/projects/${enc(projectId)}/git/diff?path=${enc(path)}`),
};
