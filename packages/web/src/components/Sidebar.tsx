import { useState } from "react";
import { Boxes, CircleGauge, FolderMinus, FolderOpen, FolderPlus, Plus } from "lucide-react";
import type { LiveStatus, Project, SessionSummary } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate, type Route } from "../router.ts";
import { useStore } from "../store.tsx";
import { timeAgo } from "../util.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";

const PAGE = 5;

export function Sidebar({ route }: { route: Route }) {
  const { projects, sessions, connected, live, refreshProjects } = useStore();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeKey = route.name === "session" ? route.key : undefined;

  // Detach only: transcripts stay on disk, and adding the folder again brings the sessions back.
  const remove = async (p: Project) => {
    const running = [...live.values()].filter((l) => l.projectId === p.id).length;
    if (running > 0) return alert(`Stop the ${running} live agent${running === 1 ? "" : "s"} in "${p.name}" before removing it.`);
    if (!confirm(`Remove "${p.name}" from rails?\n\nIts agent sessions stay on disk. Add the folder again anytime to bring them back.`)) return;
    try {
      await api.removeProject(p.id);
    } catch (e: any) {
      return alert(e.message);
    }
    if ((route.name === "home" || route.name === "session") && route.projectId === p.id) navigate(href.home());
    await refreshProjects();
  };

  return (
    <aside className="sidebar">
      <div className="brand">rails</div>
      <nav className="nav">
        <a className={"nav-item" + (route.name === "home" && !route.projectId ? " primary" : "")} href={href.home()}>
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
        <button className="icon-btn" aria-label="Add project" title="Add project" onClick={() => setAdding(true)}>
          <FolderPlus size={16} />
        </button>
      </div>

      <div className="tree">
        {projects.length === 0 && (
          <button className="empty-hint" onClick={() => setAdding(true)}>
            Add a project folder to see its agent sessions.
          </button>
        )}
        {projects.map((p) => {
          const list = sessions[p.id] ?? [];
          const shown = expanded[p.id] ? list : list.slice(0, PAGE);
          return (
            <div key={p.id} className="project">
              <div className="project-row">
                <a className="project-name" href={href.home(p.id)} title={p.path}>
                  <FolderOpen size={16} /> <span className="truncate">{p.name}</span>
                </a>
                <button className="icon-btn reveal" aria-label={`Remove ${p.name} from rails`} title="Remove project" onClick={() => void remove(p)}>
                  <FolderMinus size={16} />
                </button>
                <a className="icon-btn" aria-label={`New chat in ${p.name}`} title="New chat" href={href.home(p.id)}>
                  <Plus size={16} />
                </a>
              </div>
              {shown.map((s) => (
                <SessionRow key={s.key} s={s} projectId={p.id} active={s.key === activeKey} pending={live.get(s.key)?.pending ?? 0} />
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
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </aside>
  );
}

function SessionRow({ s, projectId, active, pending }: { s: SessionSummary; projectId: string; active: boolean; pending: number }) {
  const state = rowState(s.liveStatus, pending);
  return (
    <a className={"session-row" + (active ? " active" : "")} href={href.session(projectId, s.key)} title={s.title}>
      <span className={"dot " + state} aria-label={state === "idle" ? undefined : state} />
      <span className="truncate grow">{s.title}</span>
      <ProviderIcon provider={s.provider} />
      <span className="muted small nowrap">{timeAgo(s.updatedAt)}</span>
    </a>
  );
}

/** Dot state for a session row: a pending permission request outranks everything else. */
function rowState(liveStatus: LiveStatus | undefined, pending: number) {
  if (pending > 0) return "attention";
  if (liveStatus === "running" || liveStatus === "starting") return "running";
  if (liveStatus) return "live";
  return "idle";
}
