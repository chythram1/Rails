import { IconArrowUpRight as ArrowUpRight, IconX as X } from "@tabler/icons-react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { href } from "../router.ts";
import { FilesPanel } from "./FilesPanel.tsx";
import { GitPanel } from "./GitPanel.tsx";
import { Sprocket } from "./sprockets/Sprocket.tsx";
import { SprocketChat } from "./sprockets/SprocketChat.tsx";
import { onTabKeys } from "./tabKeys.ts";

export type SideView = "sprockets" | "files" | "git";

/**
 * The panel beside a project's workspace, opened by one toggle in the pane header (Workspace.tsx), with three
 * tabs: the project's Sprockets (their chats, where suggested replies wait), its Files and Git. Refs: Snowflake's CoCo,
 * Gumloop.
 */
export function SidePanel(props: {
  view: SideView;
  onView(view: SideView): void;
  projectId: string;
  projectName: string;
  sprocket?: SprocketData;
  refreshKey: string;
  onClose(): void;
}) {
  const { view, onView, projectId, projectName, sprocket, onClose } = props;
  const waiting = sprocket?.pending.length ?? 0;
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
          {tab("files", "Files")}
          {tab("git", "Git")}
        </div>
        <span className="grow" />
        <button className="icon-btn" aria-label="Close the side panel" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div id="side-view" className="side-view" role="tabpanel" aria-labelledby={`side-tab-${view}`}>
        {view === "git" ? (
          <GitPanel projectId={projectId} refreshKey={props.refreshKey} />
        ) : view === "files" ? (
          <FilesPanel projectId={projectId} refreshKey={props.refreshKey} />
        ) : (
          <SprocketView projectName={projectName} sprocket={sprocket} />
        )}
      </div>
    </aside>
  );
}

/** The project's Sprocket (it has one, ADR 0016): its name over its chat, or how to get one. */
function SprocketView({ projectName, sprocket }: { projectName: string; sprocket?: SprocketData }) {
  if (!sprocket)
    return (
      <div className="side-empty">
        <p>No Sprocket looks after {projectName} yet.</p>
        <p className="muted small">Attach one to this project: it tells you when a session waits for you, passes things on between sessions and watches for clashes.</p>
        <a className="btn small" href={href.sprockets()}>Go to Sprockets</a>
      </div>
    );

  return (
    <>
      <div className="side-bar">
        <p className="side-sprocket">
          <Sprocket look={sprocket.look} size={20} seed={sprocket.id} />
          <span className="truncate">{sprocket.name}</span>
          {sprocket.pending.length > 0 && (
            <span className="tab-attention" role="img" aria-label={sprocket.pending.length > 1 ? `${sprocket.pending.length} replies waiting` : "1 reply waiting"} />
          )}
        </p>
        <a className="icon-btn" href={href.sprocket(sprocket.id)} aria-label={`Open ${sprocket.name} in Sprockets`} title="Open in Sprockets">
          <ArrowUpRight size={16} />
        </a>
      </div>
      {/* A fresh chat per Sprocket, as on the Sprockets page. */}
      <div key={sprocket.id} className="side-chat">
        <SprocketChat sprocket={sprocket} panelOpen={false} embedded />
      </div>
    </>
  );
}
