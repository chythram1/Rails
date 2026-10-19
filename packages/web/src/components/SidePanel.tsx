import { useState } from "react";
import { IconArrowUpRight as ArrowUpRight, IconX as X } from "@tabler/icons-react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { href } from "../router.ts";
import { GitPanel } from "./GitPanel.tsx";
import { Sprocket } from "./sprockets/Sprocket.tsx";
import { SprocketChat } from "./sprockets/SprocketChat.tsx";

export type SideView = "sprockets" | "git";

/**
 * The panel beside a project's workspace: its Sprockets' chats (where suggested replies wait) or Git.
 * The pane header's toggles choose the view (Workspace.tsx); refs: Snowflake's CoCo, Gumloop.
 */
export function SidePanel(props: { view: SideView; projectId: string; projectName: string; sprockets: SprocketData[]; refreshKey: string; onClose(): void }) {
  const { view, projectId, onClose } = props;
  return (
    <aside className="side-panel" aria-label={view === "git" ? "Git" : "Sprockets"}>
      {view === "git" ? <GitPanel projectId={projectId} refreshKey={props.refreshKey} onClose={onClose} /> : <SprocketsView {...props} />}
    </aside>
  );
}

const CloseButton = ({ onClose }: { onClose(): void }) => (
  <button className="icon-btn" aria-label="Close the side panel" title="Close" onClick={onClose}>
    <X size={16} />
  </button>
);

/**
 * The project's Sprockets as tabs (its Coordinator first), and the chosen one's chat. It starts on one with
 * a reply waiting, else the Coordinator.
 */
function SprocketsView({ projectName, sprockets, onClose }: { projectName: string; sprockets: SprocketData[]; onClose(): void }) {
  const [chosen, setChosen] = useState<string>();
  const current =
    sprockets.find((s) => s.id === chosen) ?? sprockets.find((s) => s.pending.length) ?? sprockets.find((s) => s.coordinator) ?? sprockets[0];

  if (!current)
    return (
      <>
        <header className="side-head">
          <h2>Sprockets</h2>
          <span className="grow" />
          <CloseButton onClose={onClose} />
        </header>
        <div className="side-empty">
          <p>No Sprockets in {projectName} yet.</p>
          <p className="muted small">Attach one to this project, and make it its Coordinator: it tells you when a session waits for you and drafts your reply.</p>
          <a className="btn small" href={href.sprockets()}>Go to Sprockets</a>
        </div>
      </>
    );

  return (
    <>
      <header className="side-head side-sprockets">
        <div className="side-tabs" role="tablist" aria-label={`Sprockets in ${projectName}`}>
          {sprockets.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={s.id === current.id}
              className="side-tab"
              title={s.coordinator ? `${s.name}, Coordinator of ${projectName}` : s.name}
              onClick={() => setChosen(s.id)}
            >
              <Sprocket look={s.look} size={20} seed={s.id} />
              <span className="truncate">{s.name}</span>
              {s.pending.length > 0 && (
                <span className="tab-attention" role="img" aria-label={s.pending.length > 1 ? `${s.pending.length} replies ready` : "A reply is ready"} />
              )}
            </button>
          ))}
        </div>
        <a className="icon-btn" href={href.sprocket(current.id)} aria-label={`Open ${current.name} in Sprockets`} title="Open in Sprockets">
          <ArrowUpRight size={16} />
        </a>
        <CloseButton onClose={onClose} />
      </header>
      {/* A fresh chat per Sprocket, as on the Sprockets page. */}
      <div key={current.id} className="side-chat" role="tabpanel">
        <SprocketChat sprocket={current} panelOpen={false} embedded />
      </div>
    </>
  );
}
