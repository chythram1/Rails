import { useState } from "react";
import { IconArrowUpRight as ArrowUpRight, IconX as X } from "@tabler/icons-react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { href } from "../router.ts";
import { GitPanel } from "./GitPanel.tsx";
import { Sprocket } from "./sprockets/Sprocket.tsx";
import { SprocketChat } from "./sprockets/SprocketChat.tsx";
import { onTabKeys } from "./tabKeys.ts";

export type SideView = "sprockets" | "git";

/**
 * The panel beside a project's workspace, opened by one toggle in the pane header (Workspace.tsx), with two
 * tabs: the project's Sprockets (their chats, where suggested replies wait) and Git. Refs: Snowflake's CoCo,
 * Gumloop.
 */
export function SidePanel(props: {
  view: SideView;
  onView(view: SideView): void;
  projectId: string;
  projectName: string;
  sprockets: SprocketData[];
  refreshKey: string;
  onClose(): void;
}) {
  const { view, onView, projectId, projectName, sprockets, onClose } = props;
  const waiting = sprockets.reduce((n, s) => n + s.pending.length, 0);
  const tab = (id: SideView, label: string, dot = false) => (
    <button
      type="button"
      role="tab"
      id={`side-tab-${id}`}
      aria-selected={view === id}
      aria-controls="side-view"
      tabIndex={view === id ? 0 : -1}
      className="side-view-tab"
      onClick={() => onView(id)}
    >
      {label}
      {dot && <span className="tab-attention" role="img" aria-label={waiting > 1 ? `${waiting} replies waiting` : "1 reply waiting"} />}
    </button>
  );
  return (
    <aside className="side-panel" aria-label="Side panel">
      <header className="side-head">
        <div className="side-views" role="tablist" aria-label="Show" onKeyDown={onTabKeys}>
          {tab("sprockets", "Sprockets", waiting > 0)}
          {tab("git", "Git")}
        </div>
        <span className="grow" />
        <button className="icon-btn" aria-label="Close the side panel" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div id="side-view" className="side-view" role="tabpanel" aria-labelledby={`side-tab-${view}`}>
        {view === "git" ? <GitPanel projectId={projectId} refreshKey={props.refreshKey} /> : <SprocketsView projectName={projectName} sprockets={sprockets} />}
      </div>
    </aside>
  );
}

/**
 * The project's Sprockets as a row of tabs (its Coordinator first) over the chosen one's chat. It starts on
 * one with a reply waiting, else the Coordinator.
 */
function SprocketsView({ projectName, sprockets }: { projectName: string; sprockets: SprocketData[] }) {
  const [chosen, setChosen] = useState<string>();
  const current =
    sprockets.find((s) => s.id === chosen) ?? sprockets.find((s) => s.pending.length) ?? sprockets.find((s) => s.coordinator) ?? sprockets[0];

  if (!current)
    return (
      <div className="side-empty">
        <p>No Sprockets in {projectName} yet.</p>
        <p className="muted small">Attach one to this project, and make it its Coordinator: it tells you when a session waits for you and drafts your reply.</p>
        <a className="btn small" href={href.sprockets()}>Go to Sprockets</a>
      </div>
    );

  return (
    <>
      <div className="side-bar">
        <div className="side-tabs" role="tablist" aria-label={`Sprockets in ${projectName}`} onKeyDown={onTabKeys}>
          {sprockets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current.id}
              tabIndex={s.id === current.id ? 0 : -1}
              className="side-tab"
              title={s.coordinator ? `${s.name}, Coordinator of ${projectName}` : s.name}
              onClick={() => setChosen(s.id)}
            >
              <Sprocket look={s.look} size={20} seed={s.id} />
              <span className="truncate">{s.name}</span>
              {s.pending.length > 0 && (
                <span className="tab-attention" role="img" aria-label={s.pending.length > 1 ? `${s.pending.length} replies waiting` : "1 reply waiting"} />
              )}
            </button>
          ))}
        </div>
        <a className="icon-btn" href={href.sprocket(current.id)} aria-label={`Open ${current.name} in Sprockets`} title="Open in Sprockets">
          <ArrowUpRight size={16} />
        </a>
      </div>
      {/* A fresh chat per Sprocket, as on the Sprockets page. */}
      <div key={current.id} className="side-chat">
        <SprocketChat sprocket={current} panelOpen={false} embedded />
      </div>
    </>
  );
}
