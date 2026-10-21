import { useRef, useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import { api } from "../../api.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { MenuButton } from "../Menu.tsx";

/**
 * A chat's `…` menu (ADR 0021): Clear chat, confirmed. Clearing deletes its messages for every device; the Sprocket
 * keeps its memory, so it's starting the conversation over, not making it forget.
 */
export function ChatMenu({ chatId, name, project, empty }: { chatId: string; name: string; project?: string; empty: boolean }) {
  const [clearing, setClearing] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const what = project ? `${project}'s chat` : `your chat with ${name}`;
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
          text={`Every message in ${what} is deleted, on every device. ${name} still remembers what it learned about you.${project ? " Replies it suggested here can't be sent anymore." : ""}`}
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
