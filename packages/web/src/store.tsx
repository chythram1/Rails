import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Project, ProviderInfo, SessionSummary } from "@rails/shared";
import { api } from "./api.ts";
import { href, navigate } from "./router.ts";
import { socket } from "./ws.ts";

interface Store {
  projects: Project[];
  providers: ProviderInfo[];
  connected: boolean;
  sessions: Record<string, SessionSummary[]>;
  /** The panel focused in the open workspace (highlights its session in the sidebar). */
  activePanelId?: string;
  setActivePanelId(id: string | undefined): void;
  refreshProjects(): Promise<void>;
  /** A native folder picker is open on the server, waiting for the user. */
  picking: boolean;
  /** Add a project by choosing its folder in the server's native folder picker, then open it. */
  addProject(): Promise<void>;
  refreshSessions(projectId: string): Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connected, setConnected] = useState(socket.connected);
  const [sessions, setSessions] = useState<Record<string, SessionSummary[]>>({});
  const [activePanelId, setActivePanelId] = useState<string>();
  const [picking, setPicking] = useState(false);
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
    // Opening or closing a panel changes which sessions are open.
    const off = socket.on((m) => {
      if (m.type === "panels.changed") void refreshSessions(m.projectId);
    });
    // Pick up sessions started outside rails and new transcripts of freshly started panels.
    const poll = setInterval(() => projectsRef.current.forEach((p) => void refreshSessions(p.id)), 20_000);
    return () => {
      off();
      offConn();
      clearInterval(poll);
    };
  }, [refreshProjects, refreshSessions]);

  const addProject = useCallback(async () => {
    setPicking(true);
    try {
      const { project } = await api.pickProject();
      if (!project) return; // cancelled
      await refreshProjects();
      navigate(href.project(project.id));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setPicking(false);
    }
  }, [refreshProjects]);

  const value: Store = { projects, providers, connected, sessions, activePanelId, setActivePanelId, refreshProjects, refreshSessions, picking, addProject };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
