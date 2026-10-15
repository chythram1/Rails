import type { ProviderId } from "@rails/shared";
import claude from "../assets/providers/claude.svg";
import codex from "../assets/providers/codex.svg";
import pi from "../assets/providers/pi.svg";
import { providerLabel } from "../util.ts";
import { ProviderBadge } from "./ProviderBadge.tsx";

// Sources and licenses: assets/providers/README.md
const icons: Partial<Record<ProviderId, string>> = { claude, codex, pi };

/** Official provider logo; falls back to the text badge when a provider has no icon. */
export function ProviderIcon({ provider }: { provider: ProviderId }) {
  const src = icons[provider];
  if (!src) return <ProviderBadge provider={provider} />;
  const label = providerLabel[provider];
  return <img className="provider-icon" src={src} alt={label} title={label} width={16} height={16} />;
}
