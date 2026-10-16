import { useState } from "react";
import { Boxes, CircleGauge, FolderMinus, FolderOpen, FolderPlus, Plus } from "lucide-react";
import type { PanelKind, Project, SessionSummary } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate, type Route } from "../router.ts";
import { useStore } from "../store.tsx";
import { timeAgo } from "../util.ts";
import { PanelMenu } from "./PanelMenu.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";

const PAGE = 5;

export function Sidebar({ route }: { route: Route }) {
  const { projects, sessions, connected, activePanelId, refreshProjects, picking, addProject } = useStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
          const shown = expanded[p.id] ? list : list.slice(0, PAGE);
          return (
            <div key={p.id} className="project">
              <div className="project-row">
                <a className={"project-name" + (route.name === "workspace" && route.projectId === p.id ? " active" : "")} href={href.project(p.id)} title={p.path}>
                  <FolderOpen size={16} /> <span className="truncate">{p.name}</span>
                </a>
                <button className="icon-btn reveal" aria-label={`Remove ${p.name} from rails`} title="Remove project" onClick={() => void remove(p)}>
                  <FolderMinus size={16} />
                </button>
                <PanelMenu onPick={(kind) => void startPanel(p, kind)} />
              </div>
              {shown.map((s) => (
                <SessionRow key={s.key} s={s} projectId={p.id} active={!!s.panelId && s.panelId === activePanelId} />
              ))}
              {list.length > PAGE && (
                <button className="more" onClick={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}>
                  {expanded[p.id] ? "Show less" : `Show ${list.length - PAGE} more`}
                </button>
              )}
              {list.length === 0 && <div className="muted small indent">No sessions yet</div>}
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
