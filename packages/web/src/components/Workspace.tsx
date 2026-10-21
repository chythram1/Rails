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
import { IconAlertTriangle as Warning, IconLayoutSidebarRight as PanelRight, IconX as X } from "@tabler/icons-react";
import { parseSessionKey, sessionKey, type Panel, type PanelKind } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { shortTitle } from "../util.ts";
import { SidePanel, type SideView } from "./SidePanel.tsx";
import { useSprockets } from "./sprockets/useSprockets.ts";
import { PanelIcon, PanelMenu } from "./PanelMenu.tsx";
import { RenameSession, type Renaming } from "./RenameSession.tsx";
import { onTabKeys } from "./tabKeys.ts";
import { TerminalView } from "./TerminalView.tsx";
import { useWorkspace, type WorkspaceState } from "./useWorkspace.ts";

const MOBILE = "(max-width: 860px)";

/** What the dockview tab / content / header components need from the workspace. */
interface Ctx extends WorkspaceState {
  /** Open a panel and place it in `group` (or the active group), with an agent profile if given (ADR 0020). */
  openIn(kind: PanelKind, group?: DockviewGroupPanel, opts?: { agentProfileId?: string }): void;
  /** Whether the side panel is open. */
  sideOpen: boolean;
  /** Open the side panel (on Sprockets if a reply waits, else its last tab), or close it. */
  toggleSide(): void;
  /** Panels whose session has a reply waiting in one of the project's Sprockets (ADR 0010). */
  replyReady: Set<string>;
}
const WorkspaceCtx = createContext<Ctx | null>(null);
const useWs = () => useContext(WorkspaceCtx)!;

/** A project's workspace: its agents and shells as terminal panels (ADR 0003). */
export function Workspace({ projectId, openKey }: { projectId: string; openKey?: string }) {
  const { projects } = useStore();
  const project = projects.find((p) => p.id === projectId);
  const ws = useWorkspace(projectId);
  const [mobile, setMobile] = useState(() => matchMedia(MOBILE).matches);
  const [sideOpen, setSideOpen] = useState(false);
  const [sideView, setSideView] = useState<SideView>("sprockets");
  // The project's Sprocket (one per project, ADR 0016).
  const { list: allSprockets } = useSprockets();
  const sprocket = (allSprockets ?? []).find((s) => s.projectId === projectId);
  const replyReady = new Set(sprocket?.pending ?? []);
  const targetGroup = useRef<DockviewGroupPanel>(undefined);
  const [focusId, setFocusId] = useState<string>();

  useEffect(() => {
    const mq = matchMedia(MOBILE);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const openIn = (kind: PanelKind, group?: DockviewGroupPanel, opts: { sessionId?: string; agentProfileId?: string } = {}) => {
    targetGroup.current = group;
    void ws.open(kind, opts).then((p) => {
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
    openIn(provider, undefined, { sessionId: id });
    location.replace(href.project(projectId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, projectId]);

  if (!project) return <div className="page center muted">Project not found.</div>;

  return (
    <WorkspaceCtx.Provider
      value={{
        ...ws,
        openIn,
        sideOpen,
        toggleSide: () => {
          if (!sideOpen && replyReady.size) setSideView("sprockets");
          setSideOpen(!sideOpen);
        },
        replyReady,
      }}
    >
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
          {sideOpen && (
            <SidePanel
              view={sideView}
              onView={setSideView}
              projectId={projectId}
              projectName={project.name}
              sprocket={sprocket}
              refreshKey={String(ws.panels?.length)}
              onClose={() => setSideOpen(false)}
            />
          )}
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
        theme={themeDark} // only for its class: styles.css maps its variables to the tokens of either theme
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

/**
 * A small red dot on a panel's tab when its agent needs the user (ADR 0007), or when a Sprocket has a reply
 * ready for it (ADR 0010).
 */
function AttentionMark({ panelId }: { panelId: string }) {
  const reason = useStore().attention.get(panelId);
  const ready = useWs().replyReady.has(panelId);
  const label = reason === "waiting" ? "Needs you" : reason === "failed" ? "Turn failed" : ready ? "A reply is ready in Sprockets" : undefined;
  if (!label) return null;
  return <span className="tab-attention" role="img" aria-label={label} title={label} />;
}

/** Up to three files, then how many more. */
const someFiles = (files: string[]) => (files.length > 3 ? `${files.slice(0, 3).join(", ")} and ${files.length - 3} more` : files.join(", "));

/**
 * A small amber warning on a panel's tab while another session in the project changed the same files in the
 * last 30 minutes (ADR 0014): they may be working against each other. It says which session and which files.
 */
function OverlapMark({ panelId }: { panelId: string }) {
  const list = useStore().overlaps.get(panelId);
  const ws = useWs();
  if (!list?.length) return null;
  const label = list
    .map((o) => {
      const other = ws.panels?.find((p) => p.id === o.otherPanelId);
      return `Also changed by ${other ? `‘${shortTitle(ws.title(other))}’` : "another session"}: ${someFiles(o.files)}`;
    })
    .join("\n");
  return (
    <span className="tab-overlap" role="img" aria-label={label} title={label}>
      <Warning size={13} aria-hidden />
    </span>
  );
}

function PanelTab(props: IDockviewPanelHeaderProps) {
  const ws = useWs();
  const { sessions } = useStore();
  const panel = usePanel(props.api.id);
  const [renaming, setRenaming] = useState<Renaming>();
  if (!panel) return null;
  const title = ws.title(panel);
  // Double-clicking an agent's tab renames its session (also in the session's menu in the sidebar).
  const rename = () => {
    // A double-click inside the open dialog reaches here too: React passes events up through its portal.
    if (renaming || panel.kind === "shell" || !panel.sessionId) return;
    const s = sessions[panel.projectId]?.find((x) => x.id === panel.sessionId);
    setRenaming({ projectId: panel.projectId, key: sessionKey(panel.kind, panel.sessionId), name: panel.name, agentTitle: s?.agentTitle ?? s?.title ?? panel.title });
  };
  return (
    <div className="panel-tab" title={panel.profile && panel.profile.name !== title ? `${title} · ${panel.profile.name} profile` : title} onDoubleClick={rename}>
      {renaming && <RenameSession renaming={renaming} onClose={() => setRenaming(undefined)} />}
      <PanelIcon kind={panel.kind} />
      <span className="truncate">{title}</span>
      <OverlapMark panelId={panel.id} />
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
      <PanelMenu onPick={(kind, agentProfileId) => ws.openIn(kind, props.group, { agentProfileId })} />
    </div>
  );
}

/**
 * The side panel's toggle (SidePanel.tsx: Sprockets, Files and Git). Desktop shows it once, at the right end of the
 * top-right pane's tab bar. It carries a dot while a reply waits in one of the project's Sprockets.
 */
function SideToggles() {
  const { sideOpen, toggleSide, replyReady } = useWs();
  const ready = replyReady.size;
  const label = `Sprockets, files and Git${ready ? ` (${ready > 1 ? `${ready} replies` : "1 reply"} waiting)` : ""}`;
  return (
    <div className="side-toggles">
      <button className={"icon-btn" + (sideOpen ? " active" : "")} aria-label={label} aria-pressed={sideOpen} title={label} onClick={toggleSide}>
        <PanelRight size={16} />
        {ready > 0 && <span className="toggle-dot" aria-hidden />}
      </button>
    </div>
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
      <SideToggles />
    </div>
  ) : null;
}

function EmptyWorkspace(_: IWatermarkPanelProps) {
  const ws = useWs();
  return (
    <div className="empty-workspace">
      <div className="empty-git">
        <SideToggles />
      </div>
      <p className="muted">No panels open. Pick a session in the sidebar, or start something:</p>
      <PanelMenu onPick={(kind, agentProfileId) => ws.openIn(kind, undefined, { agentProfileId })} />
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
      <div className="mobile-tabs" role="tablist" aria-label="Panels" onKeyDown={onTabKeys}>
        {panels.map((p) => (
          <div key={p.id} className={"panel-tab" + (p.id === active?.id ? " active" : "")}>
            <button role="tab" aria-selected={p.id === active?.id} tabIndex={p.id === active?.id ? 0 : -1} className="mobile-tab" onClick={() => setActiveId(p.id)}>
              <PanelIcon kind={p.kind} />
              <span className="truncate">{ws.title(p)}</span>
              <OverlapMark panelId={p.id} />
              <AttentionMark panelId={p.id} />
            </button>
            {p.id === active?.id && (
              <button className="tab-close" aria-label={`Close ${ws.title(p)}`} onClick={() => void ws.close(p)}>
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        <PanelMenu onPick={(kind, agentProfileId) => void ws.open(kind, { agentProfileId }).then((p) => p && setActiveId(p.id))} />
        <span className="grow" />
        <SideToggles />
      </div>
      {active ? (
        <PanelBody key={active.id} panel={active} focused />
      ) : (
        <p className="muted pad">No panels open. Tap + to start an agent or shell.</p>
      )}
    </div>
  );
}
