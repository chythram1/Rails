import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  themeDark,
  type DockviewApi,
  type DockviewGroupPanel,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IWatermarkPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { IconGitBranch as GitBranch, IconX as X } from "@tabler/icons-react";
import { parseSessionKey, sessionKey, type Panel, type PanelKind } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { GitPanel } from "./GitPanel.tsx";
import { PanelIcon, PanelMenu } from "./PanelMenu.tsx";
import { TerminalView } from "./TerminalView.tsx";
import { useWorkspace, type WorkspaceState } from "./useWorkspace.ts";

const MOBILE = "(max-width: 860px)";

/** What the dockview tab / content / header components need from the workspace. */
interface Ctx extends WorkspaceState {
  /** Open a panel and place it in `group` (or the active group). */
  openIn(kind: PanelKind, group?: DockviewGroupPanel): void;
  gitOpen: boolean;
  toggleGit(): void;
}
const WorkspaceCtx = createContext<Ctx | null>(null);
const useWs = () => useContext(WorkspaceCtx)!;

/** A project's workspace: its agents and shells as terminal panels (ADR 0003). */
export function Workspace({ projectId, openKey }: { projectId: string; openKey?: string }) {
  const { projects } = useStore();
  const project = projects.find((p) => p.id === projectId);
  const ws = useWorkspace(projectId);
  const [mobile, setMobile] = useState(() => matchMedia(MOBILE).matches);
  const [gitOpen, setGitOpen] = useState(false);
  const targetGroup = useRef<DockviewGroupPanel>(undefined);
  const [focusId, setFocusId] = useState<string>();

  useEffect(() => {
    const mq = matchMedia(MOBILE);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const openIn = (kind: PanelKind, group?: DockviewGroupPanel, sessionId?: string) => {
    targetGroup.current = group;
    void ws.open(kind, sessionId).then((p) => {
      if (!p) return;
      // A session inside two projects (one folder nested in the other) has one panel, which may live in
      // the other project's workspace: go there and focus it.
      if (p.projectId !== projectId && p.kind !== "shell" && p.sessionId) navigate(href.session(p.projectId, sessionKey(p.kind, p.sessionId)));
      else setFocusId(p.id);
    });
  };

  // #/p/<id>/s/<key>: open (or focus) that session's panel, then drop the key from the URL.
  useEffect(() => {
    if (!openKey) return;
    const { provider, id } = parseSessionKey(openKey);
    openIn(provider, undefined, id);
    location.replace(href.project(projectId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, projectId]);

  if (!project) return <div className="page center muted">Project not found.</div>;

  return (
    <WorkspaceCtx.Provider value={{ ...ws, openIn, gitOpen, toggleGit: () => setGitOpen((o) => !o) }}>
      <div className="workspace">
        {ws.error && (
          <div className="workspace-error" role="alert">
            {ws.error}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => ws.setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="workspace-body">
          {ws.panels === null ? null : mobile ? <MobilePanels /> : <Dock projectId={projectId} targetGroup={targetGroup} focusId={focusId} onFocused={() => setFocusId(undefined)} />}
          {gitOpen && <GitPanel projectId={projectId} refreshKey={String(ws.panels?.length)} onClose={() => setGitOpen(false)} />}
        </div>
      </div>
    </WorkspaceCtx.Provider>
  );
}

// ---- desktop: split panes with tabs (dockview) --------------------------------

interface DockProps {
  projectId: string;
  /** Where the next new panel goes (the pane whose "+" was used). */
  targetGroup: React.RefObject<DockviewGroupPanel | undefined>;
  /** A panel to bring to the front once it exists. */
  focusId?: string;
  onFocused(): void;
}

function Dock({ projectId, targetGroup, focusId, onFocused }: DockProps) {
  const ws = useWs();
  const { setActivePanelId } = useStore();
  const [dock, setDock] = useState<DockviewApi>();
  const restored = useRef(false);

  // Mirror the server's panel list into the layout: restore the saved layout once, then add/remove.
  useEffect(() => {
    if (!dock || !ws.panels) return;
    const ids = new Set(ws.panels.map((p) => p.id));
    if (!restored.current) {
      restored.current = true;
      if (ws.layout) {
        try {
          dock.fromJSON(ws.layout as any);
        } catch {
          dock.clear(); // incompatible layout: start fresh
        }
      }
    }
    for (const panel of [...dock.panels]) if (!ids.has(panel.id)) dock.removePanel(panel);
    for (const p of ws.panels) {
      if (dock.getPanel(p.id)) continue;
      const group = targetGroup.current ?? dock.activeGroup;
      dock.addPanel({ id: p.id, component: "terminal", tabComponent: "tab", title: p.title, position: group ? { referenceGroup: group } : undefined });
    }
    targetGroup.current = undefined;
  }, [dock, ws.panels, ws.layout, targetGroup]);

  useEffect(() => {
    const panel = focusId && dock?.getPanel(focusId);
    if (!panel) return;
    panel.api.setActive();
    onFocused();
  }, [dock, focusId, ws.panels, onFocused]);

  // Save the arrangement (debounced) so every device opens the same layout.
  useEffect(() => {
    if (!dock) return;
    let timer: ReturnType<typeof setTimeout>;
    const save = dock.onDidLayoutChange(() => {
      if (!restored.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void api.saveLayout(projectId, dock.toJSON()).catch(() => {}), 400);
    });
    const active = dock.onDidActivePanelChange((e) => setActivePanelId(e.panel?.id));
    return () => {
      clearTimeout(timer);
      save.dispose();
      active.dispose();
      setActivePanelId(undefined);
    };
  }, [dock, projectId, setActivePanelId]);

  return (
    <div className="dock">
      <DockviewReact
        theme={themeDark}
        components={{ terminal: TerminalPanel }}
        tabComponents={{ tab: PanelTab }}
        leftHeaderActionsComponent={HeaderAdd}
        rightHeaderActionsComponent={HeaderGit}
        watermarkComponent={EmptyWorkspace}
        defaultRenderer="always"
        disableFloatingGroups
        onReady={(e) => setDock(e.api)}
      />
    </div>
  );
}

function usePanel(id: string): Panel | undefined {
  return useWs().panels?.find((p) => p.id === id);
}

function TerminalPanel(props: IDockviewPanelProps) {
  const panel = usePanel(props.api.id);
  const [active, setActive] = useState(props.api.isActive);
  useEffect(() => {
    const d = props.api.onDidActiveChange((e) => setActive(e.isActive));
    return () => d.dispose();
  }, [props.api]);
  if (!panel) return null;
  return <PanelBody panel={panel} focused={active} />;
}

function PanelBody({ panel, focused }: { panel: Panel; focused: boolean }) {
  return (
    <div className="panel-body">
      <TerminalView panelId={panel.id} focused={focused} />
    </div>
  );
}

/** A small red dot on a panel's tab when its agent needs the user (ADR 0007). */
function AttentionMark({ panelId }: { panelId: string }) {
  const reason = useStore().attention.get(panelId);
  if (!reason) return null;
  return <span className="tab-attention" role="img" aria-label={reason === "waiting" ? "Needs you" : "Turn failed"} title={reason === "waiting" ? "Needs you" : "Turn failed"} />;
}

function PanelTab(props: IDockviewPanelHeaderProps) {
  const ws = useWs();
  const panel = usePanel(props.api.id);
  if (!panel) return null;
  const title = ws.title(panel);
  return (
    <div className="panel-tab" title={title}>
      <PanelIcon kind={panel.kind} />
      <span className="truncate">{title}</span>
      <AttentionMark panelId={panel.id} />
      <button
        className="tab-close"
        aria-label={`Close ${title}`}
        onPointerDown={(e) => e.stopPropagation()} // don't start a tab drag
        onClick={(e) => {
          e.stopPropagation();
          void ws.close(panel);
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function HeaderAdd(props: IDockviewHeaderActionsProps) {
  const ws = useWs();
  return (
    <div className="header-add">
      <PanelMenu onPick={(kind) => ws.openIn(kind, props.group)} />
    </div>
  );
}

/** The Git panel toggle. Desktop shows it once, at the right end of the top-right pane's tab bar. */
function GitToggle() {
  const { gitOpen, toggleGit } = useWs();
  return (
    <button className={"icon-btn" + (gitOpen ? " active" : "")} aria-label="Toggle git panel" aria-pressed={gitOpen} title="Git" onClick={toggleGit}>
      <GitBranch size={16} />
    </button>
  );
}

function HeaderGit(props: IDockviewHeaderActionsProps) {
  const [topRight, setTopRight] = useState(false);
  useEffect(() => {
    // Recompute whenever panes are split, moved or resized.
    const check = () => {
      const rects = props.containerApi.groups.map((g) => g.element.getBoundingClientRect());
      const own = props.group.element.getBoundingClientRect();
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      setTopRight(Math.abs(own.top - top) < 1 && Math.abs(own.right - right) < 1);
    };
    check();
    const d = props.containerApi.onDidLayoutChange(check);
    return () => d.dispose();
  }, [props.containerApi, props.group]);
  return topRight ? (
    <div className="header-git">
      <GitToggle />
    </div>
  ) : null;
}

function EmptyWorkspace(_: IWatermarkPanelProps) {
  const ws = useWs();
  return (
    <div className="empty-workspace">
      <div className="empty-git">
        <GitToggle />
      </div>
      <p className="muted">No panels open. Pick a session in the sidebar, or start something:</p>
      <PanelMenu onPick={(kind) => ws.openIn(kind)} />
    </div>
  );
}

// ---- mobile: one panel at a time with a tab strip -----------------------------

function MobilePanels() {
  const ws = useWs();
  const { setActivePanelId } = useStore();
  const panels = ws.panels ?? [];
  const [activeId, setActiveId] = useState<string>();
  const active = panels.find((p) => p.id === activeId) ?? panels[panels.length - 1];
  useEffect(() => {
    setActivePanelId(active?.id);
    return () => setActivePanelId(undefined);
  }, [active?.id, setActivePanelId]);

  return (
    <div className="mobile-panels">
      <div className="mobile-tabs" role="tablist">
        {panels.map((p) => (
          <div key={p.id} className={"panel-tab" + (p.id === active?.id ? " active" : "")}>
            <button role="tab" aria-selected={p.id === active?.id} className="mobile-tab" onClick={() => setActiveId(p.id)}>
              <PanelIcon kind={p.kind} />
              <span className="truncate">{ws.title(p)}</span>
              <AttentionMark panelId={p.id} />
            </button>
            {p.id === active?.id && (
              <button className="tab-close" aria-label={`Close ${ws.title(p)}`} onClick={() => void ws.close(p)}>
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <PanelMenu onPick={(kind) => void ws.open(kind).then((p) => p && setActiveId(p.id))} />
        <span className="grow" />
        <GitToggle />
      </div>
      {active ? (
        <PanelBody key={active.id} panel={active} focused />
      ) : (
        <p className="muted pad">No panels open. Tap + to start an agent or shell.</p>
      )}
    </div>
  );
}
