import { useRef, useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { MenuButton } from "../Menu.tsx";

/**
 * A chat's `…` menu (ADR 0021): Clear chat, confirmed. Clearing deletes its messages for every device; the Sprocket
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
      <MenuButton
        label="Chat actions"
        title="More"
        icon={<Dots size={18} />}
        align="right"
        items={[{ label: "Clear chat…", danger: true, disabled: empty, onSelect: () => setClearing(true) }]}
      />
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
