import { useEffect, useState } from "react";
import { Boxes, CircleGauge, EllipsisVertical, Folder, FolderOpen, FolderPlus, Plus } from "lucide-react";
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

export function Sidebar({ route }: { route: Route }) {
  const { projects, sessions, connected, activePanelId, refreshProjects, picking, addProject } = useStore();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [collapsed, toggleCollapsed] = useCollapsed();

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
    <aside className="sidebar">
      <div className="brand">rails</div>
      <nav className="nav">
        <a className={"nav-item" + (route.name === "home" ? " primary" : "")} href={href.home()}>
          <Plus size={18} /> New chat
        </a>
        <a className={"nav-item" + (route.name === "customize" ? " active" : "")} href="#/customize">
          <Boxes size={18} /> Customize
        </a>
        <a className={"nav-item" + (route.name === "automate" ? " active" : "")} href="#/automate">
          <CircleGauge size={18} /> Automate
        </a>
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

      <div className="sidebar-foot">
        <span className={"dot " + (connected ? "on" : "off")} aria-hidden />
        {connected ? "Connected" : "Reconnecting…"}
        <span className="muted"> · {location.hostname}</span>
      </div>
    </aside>
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
