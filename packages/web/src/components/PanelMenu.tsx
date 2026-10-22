import { IconPlus as Plus, IconTerminal2 as SquareTerminal } from "@tabler/icons-react";
import type { PanelKind, ProviderId } from "@rails/shared";
import { useStore } from "../store.tsx";
import { providerLabel } from "../util.ts";
import { MenuButton, type MenuItem } from "./Menu.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";

const AGENTS: { id: ProviderId; key: string }[] = [
  { id: "claude", key: "c" },
  { id: "codex", key: "x" },
  { id: "pi", key: "p" },
];

/** Icon for a panel kind: the agent's logo, or a terminal glyph for shells. */
export function PanelIcon({ kind }: { kind: PanelKind }) {
  return kind === "shell" ? <SquareTerminal size={15} className="shell-icon" aria-label="Shell" /> : <ProviderIcon provider={kind} />;
}

/** The "+" that starts a new agent or shell. */
export function PanelMenu({ onPick }: { onPick(kind: PanelKind): void }) {
  const { providers } = useStore();
  const items: MenuItem[] = [
    ...AGENTS.map(({ id, key }): MenuItem => {
      const ok = providers.find((p) => p.id === id)?.installed ?? false;
      return { label: providerLabel[id], icon: <PanelIcon kind={id} />, shortcut: key, disabled: !ok, note: ok ? undefined : "not installed", onSelect: () => onPick(id) };
    }),
    "separator",
    { label: "Shell", icon: <PanelIcon kind="shell" />, shortcut: "s", onSelect: () => onPick("shell") },
  ];
  return <MenuButton label="New panel" title="New agent or shell" icon={<Plus size={16} />} items={items} />;
}
