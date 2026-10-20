import { IconMessage as Message } from "@tabler/icons-react";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { MenuButton, type MenuItem } from "../Menu.tsx";

/**
 * The saved prompts (Customize, ADR 0020) as a menu inside a composer: picking one hands its text to `onPick`
 * (the composer fills it in, still editable), and the last item opens Customize.
 */
export function SavedPromptsMenu({ onPick }: { onPick(text: string): void }) {
  const { savedPrompts } = useStore();
  const items: MenuItem[] = [
    ...(savedPrompts ?? []).map((p) => ({ label: p.name, icon: <Message size={16} />, onSelect: () => onPick(p.text) })),
    ...(savedPrompts?.length ? ["separator" as const] : []),
    { label: savedPrompts?.length ? "Manage prompts" : "Save prompts in Customize", onSelect: () => navigate(href.customize()) },
  ];
  return <MenuButton label="Saved prompts" title="Saved prompts" icon={<Message size={16} />} className="composer-prompts" items={items} />;
}
