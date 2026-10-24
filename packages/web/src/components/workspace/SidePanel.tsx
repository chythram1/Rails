import { IconArrowUpRight as ArrowUpRight, IconFolder as Folder, IconGitBranch as GitBranch, IconRobotFace as RobotFace, IconX as X } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { href } from "../../router.ts";
import { FilesPanel } from "./FilesPanel.tsx";
import { GitPanel } from "./GitPanel.tsx";
import { Sprocket } from "../sprockets/Sprocket.tsx";
import { ChatMenu } from "../sprockets/ChatMenu.tsx";
import { SprocketChat } from "../sprockets/SprocketChat.tsx";
import { onTabKeys } from "../ui/tabKeys.ts";

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
  // Icon tabs: the name is the tab's accessible name and its tooltip; the dot's words join it while a reply waits.
  const tab = (id: SideView, label: string, icon: ReactNode, dot = false) => (
    <button
      type="button"
      role="tab"
      id={`side-tab-${id}`}
      aria-selected={view === id}
      aria-controls="side-view"
      aria-label={dot ? `${label}, ${waiting > 1 ? `${waiting} replies waiting` : "1 reply waiting"}` : label}
      title={label}
      tabIndex={view === id ? 0 : -1}
      className="side-view-tab"
      onClick={() => onView(id)}
    >
      {icon}
      {dot && <span className="tab-attention" aria-hidden />}
    </button>
  );
  return (
    <aside className="side-panel" aria-label="Side panel">
      <header className="side-head">
        <div className="side-views" role="tablist" aria-label="Show" onKeyDown={onTabKeys}>
          {tab("sprockets", "Sprockets", <RobotFace size={18} />, waiting > 0)}
          {tab("files", "Files", <Folder size={18} />)}
          {tab("git", "Git", <GitBranch size={18} />)}
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

  const chat = sprocket.projectChat;
  return (
    <>
      <div className="side-bar">
        <p className="side-sprocket">
          <Sprocket look={sprocket.look} size={20} seed={sprocket.id} busy={sprocket.running} />
          <span className="truncate">{sprocket.name}</span>
          {sprocket.pending.length > 0 && (
            <span className="tab-attention" role="img" aria-label={sprocket.pending.length > 1 ? `${sprocket.pending.length} replies waiting` : "1 reply waiting"} />
          )}
        </p>
        {chat && <ChatMenu chatId={chat.id} name={sprocket.name} project={projectName} empty={!chat.lastMessage} />}
        <a className="icon-btn" href={href.sprocket(sprocket.id, true)} aria-label={`Open ${projectName}'s chat in Sprockets`} title="Open in Sprockets">
          <ArrowUpRight size={16} />
        </a>
      </div>
      {/* The project's chat (ADR 0021), fresh per chat, as on the Sprockets page. */}
      {chat && (
        <div key={chat.id} className="side-chat">
          <SprocketChat sprocket={sprocket} chat={chat} panelOpen={false} embedded />
        </div>
      )}
    </>
  );
}
