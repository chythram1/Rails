import { useCallback, useEffect, useState } from "react";
import type { Panel, PanelKind, Workspace } from "@rails/shared";
import { api, ApiError } from "../api.ts";
import { useStore } from "../store.tsx";
import { socket } from "../ws.ts";

/**
 * A project's panels, as the server reports them. The server list is the source of truth; the
 * desktop layout and the mobile tab strip both mirror it.
 */
export function useWorkspace(projectId: string) {
  const { sessions, refreshSessions } = useStore();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  /** A resume the server held back because the session looks active in another terminal (experimental). */
  const [activeElsewhere, setActiveElsewhere] = useState<{ kind: PanelKind; sessionId: string; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setWorkspace(await api.workspace(projectId));
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId]);

  useEffect(() => {
    setWorkspace(null);
    void load();
    return socket.on((m) => {
      if (m.type === "panels.changed" && m.projectId === projectId) void load();
    });
  }, [projectId, load]);

  /** Open a new panel, or focus the panel an existing session is already open in. */
  const open = useCallback(
    async (kind: PanelKind, sessionId?: string, force = false): Promise<Panel | undefined> => {
      setError("");
      setActiveElsewhere(null);
      try {
        const panel = await api.openPanel(projectId, { kind, sessionId, force });
        await load();
        void refreshSessions(projectId);
        return panel;
      } catch (e: any) {
        if (e instanceof ApiError && e.code === "session_active" && sessionId) setActiveElsewhere({ kind, sessionId, message: e.message });
        else setError(e.message);
      }
    },
    [projectId, load, refreshSessions],
  );

  const title = useCallback(
    (p: Panel) => sessions[projectId]?.find((s) => s.id === p.sessionId)?.title ?? p.title,
    [sessions, projectId],
  );

  /** Close a panel, which stops its process. (A process that exits on its own closes its panel.) */
  const close = useCallback(
    async (p: Panel) => {
      try {
        await api.closePanel(p.id);
      } catch (e: any) {
        setError(e.message);
      }
      await load();
      void refreshSessions(projectId);
    },
    [load, refreshSessions, projectId],
  );

  return {
    panels: workspace?.panels ?? null,
    layout: workspace?.layout ?? null,
    error,
    setError,
    activeElsewhere,
    dismissActiveElsewhere: () => setActiveElsewhere(null),
    open,
    close,
    title,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
