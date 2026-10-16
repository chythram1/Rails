import { useCallback, useEffect, useState } from "react";
import type { Panel, PanelKind, Workspace } from "@rails/shared";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { providerLabel } from "../util.ts";
import { socket } from "../ws.ts";

/**
 * A project's panels, as the server reports them. The server list is the source of truth; the
 * desktop layout and the mobile tab strip both mirror it.
 */
export function useWorkspace(projectId: string) {
  const { sessions, refreshSessions } = useStore();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [exited, setExited] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const w = await api.workspace(projectId);
      setWorkspace(w);
      setExited(new Set(w.panels.filter((p) => p.exited).map((p) => p.id)));
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

  /** Open a new panel, or the panel of an existing session (restarting it if it had exited). */
  const open = useCallback(
    async (kind: PanelKind, sessionId?: string): Promise<Panel | undefined> => {
      setError("");
      try {
        const panel = await api.openPanel(projectId, { kind, sessionId });
        await load();
        void refreshSessions(projectId);
        return panel;
      } catch (e: any) {
        setError(e.message);
      }
    },
    [projectId, load, refreshSessions],
  );

  const title = useCallback(
    (p: Panel) => sessions[projectId]?.find((s) => s.id === p.sessionId)?.title ?? p.title,
    [sessions, projectId],
  );

  /** Close a panel, which stops its process. Asks first unless the process already exited. */
  const close = useCallback(
    async (p: Panel) => {
      if (!exited.has(p.id)) {
        const what = p.kind === "shell" ? "Anything running in this shell stops." : `This stops ${providerLabel[p.kind]}. You can resume the session from the sidebar.`;
        if (!confirm(`Close "${title(p)}"?\n\n${what}`)) return;
      }
      try {
        await api.closePanel(p.id);
      } catch (e: any) {
        setError(e.message);
      }
      await load();
      void refreshSessions(projectId);
    },
    [exited, title, load, refreshSessions, projectId],
  );

  const markExited = useCallback((id: string) => setExited((s) => new Set(s).add(id)), []);

  return { panels: workspace?.panels ?? null, layout: workspace?.layout ?? null, exited, error, setError, open, close, title, markExited };
}

export type WorkspaceState = ReturnType<typeof useWorkspace>;
