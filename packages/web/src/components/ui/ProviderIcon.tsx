import type { ProviderId } from "@rails/shared";
import claude from "../../assets/providers/claude.svg";
import codex from "../../assets/providers/codex.svg";
import pi from "../../assets/providers/pi.svg";
import { providerLabel } from "../../util.ts";

// Sources and licenses: assets/providers/README.md
const icons: Record<ProviderId, string> = { claude, codex, pi };

/** Official provider logo. */
export function ProviderIcon({ provider }: { provider: ProviderId }) {
  const label = providerLabel[provider];
  return <img className="provider-icon" src={icons[provider]} alt={label} title={label} width={16} height={16} />;
}
