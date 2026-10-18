import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AttentionReason, Profile, ProfileChange, Project, ProviderInfo, SessionSummary } from "@rails/shared";
import { api } from "./api.ts";
import { href, navigate } from "./router.ts";
import { socket } from "./ws.ts";

interface Store {
  projects: Project[];
  providers: ProviderInfo[];
  connected: boolean;
  /** The name and avatar at the foot of the sidebar; null until the socket first connects. */
  profile: Profile | null;
  /** Change the profile. Throws with the server's message. */
  saveProfile(change: ProfileChange): Promise<void>;
  /** Panels whose agent is working right now (thinking or replying). */
  busy: Set<string>;
  /** Panels whose agent needs the user, and why (ADR 0007). */
  attention: Map<string, AttentionReason>;
  sessions: Record<string, SessionSummary[]>;
  /** The panel focused in the open workspace (highlights its session in the sidebar). */
  activePanelId?: string;
  setActivePanelId(id: string | undefined): void;
  refreshProjects(): Promise<void>;
  /** A native folder picker is open on the server, waiting for the user. */
  picking: boolean;
  /** Add a project by choosing its folder in the server's native folder picker, then open it. */
  openFolder(): Promise<void>;
  /** Add a folder as a project and open it. */
  chooseFolder(path: string): Promise<void>;
  refreshSessions(projectId: string): Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connected, setConnected] = useState(socket.connected);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [attention, setAttention] = useState<Map<string, AttentionReason>>(new Map());
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
    const offConn = socket.onConnection((up) => {
      setConnected(up);
      if (!up) setBusy(new Set()); // unknown until the server sends it again
    });
    const off = socket.on((m) => {
      // Opening or closing a panel changes which sessions are open.
      if (m.type === "panels.changed") void refreshSessions(m.projectId);
      if (m.type === "panels.busy") setBusy(new Set(m.panelIds));
      if (m.type === "panels.attention") setAttention(new Map(m.panels.map((a) => [a.panelId, a.reason])));
      if (m.type === "profile.changed") setProfile(m.profile); // on connect too
    });
    // Pick up sessions started outside rails and new transcripts of freshly started panels.
    const poll = setInterval(() => projectsRef.current.forEach((p) => void refreshSessions(p.id)), 20_000);
    return () => {
      off();
      offConn();
      clearInterval(poll);
    };
  }, [refreshProjects, refreshSessions]);

  const openFolder = useCallback(async () => {
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

  const chooseFolder = useCallback(
    async (path: string) => {
      try {
        const { id } = await api.addProject(path);
        await refreshProjects();
        navigate(href.project(id));
      } catch (e: any) {
        alert(e.message);
      }
    },
    [refreshProjects],
  );

  const saveProfile = useCallback(async (change: ProfileChange) => {
    setProfile(await api.updateProfile(change));
  }, []);

  const value: Store = {
    projects,
    providers,
    connected,
    profile,
    saveProfile,
    busy,
    attention,
    sessions,
    activePanelId,
    setActivePanelId,
    refreshProjects,
    refreshSessions,
    picking,
    openFolder,
    chooseFolder,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
