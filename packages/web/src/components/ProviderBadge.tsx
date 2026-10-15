import type { ProviderId } from "@rails/shared";
import { providerLabel } from "../util.ts";

const short: Record<ProviderId, string> = { claude: "CC", codex: "CX", pi: "pi" };

export function ProviderBadge({ provider }: { provider: ProviderId }) {
  return (
    <span className={"badge p-" + provider} title={providerLabel[provider]}>
      {short[provider]}
    </span>
  );
}
