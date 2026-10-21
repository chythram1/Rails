import { useRef, useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import type { Sprocket as SprocketData, SprocketGroup } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { MenuButton, type MenuItem } from "../Menu.tsx";
import { GroupDialog } from "./GroupDialog.tsx";

interface Props {
  chatId: string;
  /** The Sprocket that answers; in a group, the group's name. */
  name: string;
  /** For a project chat: the project's name. */
  project?: string;
  /** For a group chat (ADR 0022): the group, and every Sprocket to pick members from. */
  group?: { info: SprocketGroup; all: SprocketData[] };
  empty: boolean;
}

/**
 * A chat's `…` menu (ADR 0021): Clear chat, confirmed. Clearing deletes its messages for every device; the Sprocket
 * keeps its memory, so it's starting the conversation over, not making it forget. A group's (ADR 0022) also edits
 * the group or deletes it.
 */
export function ChatMenu({ chatId, name, project, group, empty }: Props) {
  const { projects } = useStore();
  const [open, setOpen] = useState<"clear" | "edit" | "delete" | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = () => wrap.current?.querySelector("button") ?? null;
  const what = group ? `${name}'s chat` : project ? `${project}'s chat` : `your chat with ${name}`;
  const remembers = group ? "Its Sprockets still remember what they learned about you." : `${name} still remembers what it learned about you.`;
  const clear: MenuItem = { label: "Clear chat…", danger: true, disabled: empty, onSelect: () => setOpen("clear") };
  const items: MenuItem[] = group
    ? [{ label: "Edit group…", onSelect: () => setOpen("edit") }, clear, "separator", { label: "Delete group…", danger: true, onSelect: () => setOpen("delete") }]
    : [clear];
  return (
    <span ref={wrap} className="chat-menu">
      <MenuButton label="Chat actions" title="More" icon={<Dots size={18} />} align="right" items={items} />
      {open === "clear" && (
        <ConfirmDialog
          title="Clear this chat?"
          text={`Every message in ${what} is deleted, on every device. ${remembers}${project || group ? " Replies suggested here can't be sent anymore." : ""}`}
          action="Clear chat"
          danger
          onConfirm={() => api.clearChat(chatId).then(() => undefined)}
          onClose={() => setOpen(null)}
          returnFocus={button}
        />
      )}
      {open === "edit" && group && (
        <GroupDialog group={group.info} all={group.all} projects={projects} onSaved={() => {}} onClose={() => setOpen(null)} returnFocus={button} />
      )}
      {open === "delete" && (
        <ConfirmDialog
          title="Delete this group?"
          text={`${name} and its chat are deleted, on every device. Its Sprockets stay, with their own chats and memory.`}
          action="Delete group"
          danger
          onConfirm={async () => {
            await api.deleteGroup(chatId);
            navigate(href.sprockets());
          }}
          onClose={() => setOpen(null)}
          returnFocus={button}
        />
      )}
    </span>
  );
}
