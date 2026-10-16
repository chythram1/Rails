import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ProviderId, ProviderInfo } from "@rails/shared";
import { claudeDiscovery } from "./claude.ts";
import { codexDiscovery } from "./codex.ts";
import { piDiscovery } from "./pi.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";

export const discovery: Record<ProviderId, DiscoveryAdapter> = {
  claude: claudeDiscovery,
  pi: piDiscovery,
  codex: codexDiscovery,
};

/** Whether a provider's CLI (`claude`, `pi`, `codex`) is on the server's PATH. */
export function installed(provider: ProviderId): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir && existsSync(join(dir, provider)));
}

export function providerInfo(): ProviderInfo[] {
  return Object.values(discovery).map((a) => ({
    id: a.id,
    name: a.name,
    discoverable: a.available(),
    installed: installed(a.id),
  }));
}

export async function scanAll(): Promise<DiscoveredSession[]> {
  const results = await Promise.all(Object.values(discovery).map((a) => (a.available() ? a.scan() : [])));
  return results.flat();
}

export const isWithin = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(dir.endsWith("/") ? dir : dir + "/");

export async function sessionsFor(dir: string): Promise<DiscoveredSession[]> {
  return (await scanAll()).filter((s) => isWithin(s.cwd, dir)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findSession(provider: ProviderId, id: string): Promise<DiscoveredSession | undefined> {
  const a = discovery[provider];
  if (!a?.available()) return undefined;
  return (await a.scan()).find((s) => s.id === id);
}
