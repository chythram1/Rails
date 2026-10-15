import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseSessionKey, type LiveSessionInfo, type Project, type ProviderInfo, type SessionSummary } from "@rails/shared";
import { api } from "./api.ts";
import { socket } from "./ws.ts";

interface Store {
  projects: Project[];
  providers: ProviderInfo[];
  live: Map<string, LiveSessionInfo>;
  connected: boolean;
  sessions: Record<string, SessionSummary[]>;
  refreshProjects(): Promise<void>;
  refreshSessions(projectId: string): Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [live, setLive] = useState<Map<string, LiveSessionInfo>>(new Map());
  const [connected, setConnected] = useState(socket.connected);
  const [sessions, setSessions] = useState<Record<string, SessionSummary[]>>({});
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const refreshSessions = useCallback(async (projectId: string) => {
    const list = await api.sessions(projectId).catch(() => null);
    if (list) setSessions((s) => ({ ...s, [projectId]: list }));
  }, []);

  const refreshProjects = useCallback(async () => {
    const list = await api.projects();
    setProjects(list);
    await Promise.all(list.map((p) => refreshSessions(p.id)));
  }, [refreshSessions]);

  useEffect(() => {
    socket.connect();
    void refreshProjects();
    void api.providers().then(setProviders);
    const offConn = socket.onConnection(setConnected);
    // Refresh a project's session list when its set of live sessions changes.
    let prev = new Map<string, LiveSessionInfo>();
    const off = socket.on((m) => {
      if (m.type !== "live") return;
      const next = new Map(m.sessions.map((s) => [s.key, s]));
      const changed = new Set<string>();
      for (const [k, s] of next) if (prev.get(k)?.status !== s.status) changed.add(s.projectId);
      for (const [k, s] of prev) if (!next.has(k)) changed.add(s.projectId);
      prev = next;
      setLive(next);
      changed.forEach((id) => void refreshSessions(id));
    });
    // Pick up sessions started outside rails.
    const poll = setInterval(() => projectsRef.current.forEach((p) => void refreshSessions(p.id)), 20_000);
    return () => {
      off();
      offConn();
      clearInterval(poll);
    };
  }, [refreshProjects, refreshSessions]);

  // Live sessions whose transcript isn't on disk yet still need a sidebar row.
  const merged = useMemo(() => {
    const out: Record<string, SessionSummary[]> = {};
    for (const p of projects) {
      const list = sessions[p.id] ?? [];
      const known = new Set(list.map((s) => s.key));
      const extra: SessionSummary[] = [...live.values()]
        .filter((l) => l.projectId === p.id && !known.has(l.key))
        .map((l) => {
          const { provider, id } = parseSessionKey(l.key);
          const now = new Date().toISOString();
          return { key: l.key, provider, id, cwd: p.path, title: "New session", createdAt: now, updatedAt: now, liveStatus: l.status };
        });
      out[p.id] = [...extra, ...list.map((s) => ({ ...s, liveStatus: live.get(s.key)?.status }))];
    }
    return out;
  }, [projects, sessions, live]);

  const value: Store = { projects, providers, live, connected, sessions: merged, refreshProjects, refreshSessions };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
