import { useRef, useState } from "react";
import { IconRotate as StartOver } from "@tabler/icons-react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";

/**
 * A chat's Clear chat button (ADR 0021), an arrow going round (it starts the chat over), confirmed. Clearing deletes its messages for every device; the Sprocket
 * keeps its memory, so it's starting the conversation over, not making it forget. A team's (ADR 0022) is the same;
 * the team itself is changed or deleted in its settings panel.
 */
export function ChatMenu({ chatId, name, project, team = false, empty }: { chatId: string; name: string; project?: string; team?: boolean; empty: boolean }) {
  const [clearing, setClearing] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const what = team ? `${name}'s chat` : project ? `${project}'s chat` : `your chat with ${name}`;
  const remembers = team ? "Its Sprockets still remember what they learned about you." : `${name} still remembers what it learned about you.`;
  return (
    <span ref={wrap} className="chat-menu">
      <button
        type="button"
        className="icon-btn"
        aria-label="Clear chat"
        title={empty ? "Nothing to clear yet" : "Clear chat"}
        disabled={empty}
        onClick={() => setClearing(true)}
      >
        <StartOver size={18} />
      </button>
      {clearing && (
        <ConfirmDialog
          title="Clear this chat?"
          text={`Every message in ${what} is deleted, on every device. ${remembers}${project || team ? " Replies suggested here can't be sent anymore." : ""}`}
          action="Clear chat"
          danger
          onConfirm={() => api.clearChat(chatId).then(() => undefined)}
          onClose={() => setClearing(false)}
          returnFocus={() => wrap.current?.querySelector("button") ?? null}
        />
      )}
    </span>
  );
}
