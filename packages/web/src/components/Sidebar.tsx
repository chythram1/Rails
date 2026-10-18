import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconPackages as Boxes, IconGauge as CircleGauge, IconSettings as Cog, IconDotsVertical as EllipsisVertical, IconFolder as Folder, IconFolderOpen as FolderOpen, IconFolderPlus as FolderPlus, IconLayoutSidebar as PanelLeft, IconLogout as LogOut, IconPlus as Plus, IconRobotFace as RobotFace, IconSelector as Selector } from "@tabler/icons-react";
import type { AttentionReason, PanelKind, Project, SessionSummary } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate, type Route } from "../router.ts";
import logo from "../assets/logo.svg";
import { useStore } from "../store.tsx";
import { timeAgo } from "../util.ts";
import { FolderMenu } from "./FolderMenu.tsx";
import { MenuButton } from "./Menu.tsx";
import { PanelMenu } from "./PanelMenu.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { useOpenSettings } from "./settings/context.ts";

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
// COLLAPSE_AT snaps it to the icon rail (its width is --rail-w in styles.css), and dragging the rail out
// past COLLAPSE_AT expands it again.
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
  const { projects, sessions, connected, busy, attention, activePanelId, refreshProjects } = useStore();
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
    const attached = ((await api.sprockets().catch(() => [])) ?? []).filter((s) => s.projectId === p.id).map((s) => s.name);
    const sprocketNote = attached.length
      ? `\n\n${attached.join(", ")} ${attached.length === 1 ? "is" : "are"} detached, and ${attached.length === 1 ? "its chat" : "their chats"} here deleted.`
      : "";
    if (!confirm(`Remove "${p.name}" from Rails?\n\nIts agent sessions stay on disk. Add the folder again anytime to bring them back.${sprocketNote}`)) return;
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
    <aside ref={aside} className={"sidebar" + (rail ? " rail" : "") + (dragging ? " dragging" : "")} style={rail ? undefined : { width }}>
      <div className="brand">
        <img className="brand-logo" src={logo} alt="Rails" width={24} height={24} />
        <button
          className="icon-btn"
          aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
          title={rail ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setSize((s) => ({ ...s, rail: !s.rail }))}
        >
          {/* In the icon rail this button shows the logo, and the panel icon on hover/focus. */}
          <img className="toggle-logo" src={logo} alt="" width={24} height={24} />
          <PanelLeft size={16} className="toggle-icon" />
        </button>
      </div>
      <nav className="nav">
        <NavItem href={href.home()} icon={<Plus size={18} />} label="New chat" rail={rail} className={route.name === "home" ? "primary" : ""} />
        <NavItem href={href.sprockets()} icon={<RobotFace size={18} />} label="Sprockets" rail={rail} className={route.name === "sprockets" ? "active" : ""} />
        <NavItem href="#/customize" icon={<Boxes size={18} />} label="Customize" rail={rail} className={route.name === "customize" ? "active" : ""} />
        <NavItem href="#/automate" icon={<CircleGauge size={18} />} label="Automate" rail={rail} className={route.name === "automate" ? "active" : ""} />
      </nav>

      <div className="section-head">
        <span>Projects</span>
        <FolderMenu label="Add project" className="icon-btn">
          <FolderPlus size={16} />
        </FolderMenu>
      </div>

      <div className="tree">
        {projects.length === 0 && (
          <FolderMenu label="Add project" className="empty-hint">
            Add a project folder to see its agent sessions.
          </FolderMenu>
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
                    items={[{ label: "Remove", shortcut: "r", danger: true, onSelect: () => void remove(p) }]}
                  />
                  <PanelMenu onPick={(kind) => void startPanel(p, kind)} />
                </span>
              </div>
              {isOpen && (
                <>
                  {shown.map((s) => (
                    <SessionRow key={s.key} s={s} projectId={p.id} active={!!s.panelId && s.panelId === activePanelId} busy={!!s.panelId && busy.has(s.panelId)} attention={s.panelId ? attention.get(s.panelId) : undefined} />
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
        <AccountMenu connected={connected} />
      </div>
      <div className="sidebar-resize" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={startResize} />
    </aside>
  );
}

/**
 * The account row at the foot of the sidebar (Claude's pattern): Rails and the connection state, opening
 * a menu with Settings and Sign out. In the icon rail only the logo shows, with the state as a dot.
 */
function AccountMenu({ connected }: { connected: boolean }) {
  const openSettings = useOpenSettings();
  const state = connected ? "Connected" : "Reconnecting…";
  const signOut = () => void api.logout().catch((e: Error) => alert(e.message)); // the app switches to sign-in
  return (
    <MenuButton
      plain
      className="account-row"
      label={`Rails, ${state}. Settings and sign out`}
      title={`${state} · ${location.host}`}
      items={[
        { label: "Settings", icon: <Cog size={16} />, shortcut: "s", onSelect: () => openSettings() },
        { label: "Sign out", icon: <LogOut size={16} />, onSelect: signOut },
      ]}
      icon={
        <>
          <span className="account-avatar" aria-hidden>
            <img src={logo} alt="" width={18} height={18} />
            <span className={"dot " + (connected ? "on" : "off")} />
          </span>
          <span className="label account-text">
            <span className="account-name">Rails</span>
            <span className="muted small truncate">{state}</span>
          </span>
          <Selector size={16} className="label account-chevron" aria-hidden />
        </>
      }
    />
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

/**
 * A session in the sidebar. Its dot: grey = not open, green = open in a panel, yellow = the agent is working,
 * red = it needs you (waiting for a permission or answer, or its turn failed).
 */
function SessionRow({ s, projectId, active, busy, attention }: { s: SessionSummary; projectId: string; active: boolean; busy: boolean; attention?: AttentionReason }) {
  const state = attention ? "attention" : busy ? "busy" : s.panelId ? "live" : "idle";
  const label = attention === "waiting" ? "needs you" : attention === "failed" ? "failed" : busy ? "working" : s.panelId ? "open in a panel" : undefined;
  return (
    <a className={"session-row" + (active ? " active" : "")} href={href.session(projectId, s.key)} title={s.title}>
      <span className={"dot " + state} role={label ? "img" : undefined} aria-label={label} />
      <span className="truncate grow">{s.title}</span>
      <ProviderIcon provider={s.provider} />
      <span className="muted small session-time">{timeAgo(s.updatedAt)}</span>
    </a>
  );
}
