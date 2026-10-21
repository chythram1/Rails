import { IconAdjustmentsHorizontal as Adjustments, IconPlus as Plus, IconTerminal2 as SquareTerminal } from "@tabler/icons-react";
import type { PanelKind, ProviderId } from "@rails/shared";
import { href, navigate } from "../router.ts";
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

/** The "+" that starts a new agent or shell, or an agent with one of the agent profiles (ADR 0018). */
export function PanelMenu({ onPick }: { onPick(kind: PanelKind, agentProfileId?: string): void }) {
  const { providers, agentProfiles } = useStore();
  const isInstalled = (id: ProviderId) => providers.find((p) => p.id === id)?.installed ?? false;
  const items: MenuItem[] = [
    ...AGENTS.map(({ id, key }) => {
      const ok = isInstalled(id);
      // It starts with its default profile, if it has one.
      const byDefault = agentProfiles?.find((p) => p.provider === id && p.isDefault);
      return { label: providerLabel[id], icon: <PanelIcon kind={id} />, shortcut: key, disabled: !ok, note: ok ? byDefault?.name : "not installed", onSelect: () => onPick(id) };
    }),
    "separator",
    { label: "Shell", icon: <PanelIcon kind="shell" />, shortcut: "s", onSelect: () => onPick("shell") },
    "separator",
    { heading: "Agent profiles" },
    ...(agentProfiles ?? []).map((p) => {
      const ok = isInstalled(p.provider);
      return { label: p.name, icon: <PanelIcon kind={p.provider} />, disabled: !ok, note: ok ? undefined : "not installed", onSelect: () => onPick(p.provider, p.id) };
    }),
    {
      label: agentProfiles?.length ? "Manage agent profiles" : "Make an agent profile",
      icon: <Adjustments size={16} aria-hidden />,
      onSelect: () => navigate(href.customize()),
    },
  ];
  return <MenuButton label="New panel" title="New agent or shell" icon={<Plus size={16} />} items={items} />;
}
