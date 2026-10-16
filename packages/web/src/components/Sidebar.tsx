import { useEffect, useRef, useState, type ReactNode } from "react";
import { Boxes, CircleGauge, EllipsisVertical, Folder, FolderOpen, FolderPlus, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import type { PanelKind, Project, SessionSummary } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate, type Route } from "../router.ts";
import { useStore } from "../store.tsx";
import { timeAgo } from "../util.ts";
import { MenuButton } from "./Menu.tsx";
import { PanelMenu } from "./PanelMenu.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";

const PAGE = 5;
const COLLAPSED_KEY = "rails.collapsedProjects";

/** Ids of collapsed projects, remembered per device. */
function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])), [collapsed]);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return [collapsed, toggle] as const;
}

// Sidebar width (desktop). Dragging the edge resizes it between MIN_W and MAX_W; dragging below
// COLLAPSE_AT snaps it to the icon rail, and dragging the rail out past COLLAPSE_AT expands it again.
const RAIL_W = 60;
const MIN_W = 220;
const MAX_W = 480;
const COLLAPSE_AT = 150;
const SIZE_KEY = "rails.sidebar";

/** Sidebar width and icon-rail state, remembered per device. */
function useSidebarSize() {
  const [size, setSize] = useState<{ width: number; rail: boolean }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null");
      if (typeof saved?.width === "number") return { width: clamp(saved.width), rail: !!saved.rail };
    } catch {}
    return { width: 300, rail: false };
  });
  useEffect(() => localStorage.setItem(SIZE_KEY, JSON.stringify(size)), [size]);
  return [size, setSize] as const;
}

const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, Math.round(w)));

export function Sidebar({ route }: { route: Route }) {
  const { projects, sessions, connected, activePanelId, refreshProjects, picking, addProject } = useStore();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [{ width, rail }, setSize] = useSidebarSize();
  const [dragging, setDragging] = useState(false);
  const aside = useRef<HTMLElement>(null);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); // no text selection while dragging
    const left = aside.current!.getBoundingClientRect().left;
    setDragging(true);
    document.body.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      const w = ev.clientX - left;
      setSize((s) => (w < COLLAPSE_AT ? { ...s, rail: true } : { width: clamp(w), rail: false }));
    };
    const up = () => {
      setDragging(false);
      document.body.classList.remove("resizing");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  // Detach only: transcripts stay on disk, and adding the folder again brings the sessions back.
  const remove = async (p: Project) => {
    const open = (await api.workspace(p.id).catch(() => null))?.panels.length ?? 0;
    if (open > 0) return alert(`Close the ${open} open panel${open === 1 ? "" : "s"} in "${p.name}" before removing it.`);
    if (!confirm(`Remove "${p.name}" from rails?\n\nIts agent sessions stay on disk. Add the folder again anytime to bring them back.`)) return;
    try {
      await api.removeProject(p.id);
    } catch (e: any) {
      return alert(e.message);
    }
    if (route.name === "workspace" && route.projectId === p.id) navigate(href.home());
    await refreshProjects();
  };

  const startPanel = async (p: Project, kind: PanelKind) => {
    try {
      await api.openPanel(p.id, { kind });
      navigate(href.project(p.id));
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <aside ref={aside} className={"sidebar" + (rail ? " rail" : "") + (dragging ? " dragging" : "")} style={{ width: rail ? RAIL_W : width }}>
      <div className="brand">
        <span className="brand-name">rails</span>
        <button
          className="icon-btn"
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          title={rail ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSize((s) => ({ ...s, rail: !s.rail }))}
        >
          {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      <nav className="nav">
        <NavItem href={href.home()} icon={<Plus size={18} />} label="New chat" rail={rail} className={route.name === "home" ? "primary" : ""} />
        <NavItem href="#/customize" icon={<Boxes size={18} />} label="Customize" rail={rail} className={route.name === "customize" ? "active" : ""} />
        <NavItem href="#/automate" icon={<CircleGauge size={18} />} label="Automate" rail={rail} className={route.name === "automate" ? "active" : ""} />
      </nav>

      <div className="section-head">
        <span>Projects</span>
        <button className="icon-btn" aria-label="Add project" title={picking ? "Choose a folder in the window that opened" : "Add project"} disabled={picking} onClick={() => void addProject()}>
          <FolderPlus size={16} />
        </button>
      </div>

      <div className="tree">
        {projects.length === 0 && (
          <button className="empty-hint" disabled={picking} onClick={() => void addProject()}>
            Add a project folder to see its agent sessions.
          </button>
        )}
        {projects.map((p) => {
          const list = sessions[p.id] ?? [];
          const shown = showAll[p.id] ? list : list.slice(0, PAGE);
          const isOpen = !collapsed.has(p.id);
          const active = route.name === "workspace" && route.projectId === p.id;
          return (
            <div key={p.id} className="project">
              {/* The whole row toggles the project's session list. Workspaces open from sessions and +. */}
              <div className="project-row" onClick={() => toggleCollapsed(p.id)}>
                <button className={"project-name" + (active ? " active" : "")} aria-expanded={isOpen} title={p.path}>
                  {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />} <span className="truncate">{p.name}</span>
                </button>
                {/* Row actions keep their own behaviour and don't toggle the row. */}
                <span className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <MenuButton
                    label={`${p.name} actions`}
                    title="More"
                    icon={<EllipsisVertical size={16} />}
                    className="reveal"
                    align="right"
                    items={[{ label: "Remove from rails", shortcut: "r", danger: true, onSelect: () => void remove(p) }]}
                  />
                  <PanelMenu onPick={(kind) => void startPanel(p, kind)} />
                </span>
              </div>
              {isOpen && (
                <>
                  {shown.map((s) => (
                    <SessionRow key={s.key} s={s} projectId={p.id} active={!!s.panelId && s.panelId === activePanelId} />
                  ))}
                  {list.length > PAGE && (
                    <button className="more" onClick={() => setShowAll((e) => ({ ...e, [p.id]: !e[p.id] }))}>
                      {showAll[p.id] ? "Show less" : `Show ${list.length - PAGE} more`}
                    </button>
                  )}
                  {list.length === 0 && <div className="muted small indent">No sessions yet</div>}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-foot" title={rail ? (connected ? "Connected" : "Reconnecting…") : undefined}>
        <span className={"dot " + (connected ? "on" : "off")} aria-hidden />
        <span className="label">
          {connected ? "Connected" : "Reconnecting…"}
          <span className="muted"> · {location.hostname}</span>
        </span>
      </div>
      <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={startResize} />
    </aside>
  );
}

/** A main navigation link. In the icon rail only the icon shows, so the label moves to a tooltip. */
function NavItem({ href, icon, label, rail, className }: { href: string; icon: ReactNode; label: string; rail: boolean; className: string }) {
  return (
    <a className={"nav-item " + className} href={href} title={rail ? label : undefined} aria-label={rail ? label : undefined}>
      {icon} <span className="label">{label}</span>
    </a>
  );
}

function SessionRow({ s, projectId, active }: { s: SessionSummary; projectId: string; active: boolean }) {
  const state = s.panelId ? "live" : "idle";
  return (
    <a className={"session-row" + (active ? " active" : "")} href={href.session(projectId, s.key)} title={s.title}>
      <span className={"dot " + state} aria-label={s.panelId ? "open in a panel" : undefined} />
      <span className="truncate grow">{s.title}</span>
      <ProviderIcon provider={s.provider} />
      <span className="muted small nowrap">{timeAgo(s.updatedAt)}</span>
    </a>
  );
}
