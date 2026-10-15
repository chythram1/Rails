import type { ProviderId, ProviderInfo, ProjectSuggestion } from "@rails/shared";
import { claudeDiscovery } from "./claude.ts";
import { codexDiscovery } from "./codex.ts";
import { piDiscovery } from "./pi.ts";
import type { DiscoveredSession, DiscoveryAdapter } from "./types.ts";

export const discovery: Record<ProviderId, DiscoveryAdapter> = {
  claude: claudeDiscovery,
  pi: piDiscovery,
  codex: codexDiscovery,
};

/** Providers rails can drive live today. */
export const LIVE_PROVIDERS: ProviderId[] = ["claude"];

export function providerInfo(): ProviderInfo[] {
  return Object.values(discovery).map((a) => ({
    id: a.id,
    name: a.name,
    discoverable: a.available(),
    live: LIVE_PROVIDERS.includes(a.id),
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

export async function suggestions(exclude: string[]): Promise<ProjectSuggestion[]> {
  const byCwd = new Map<string, ProjectSuggestion>();
  for (const s of await scanAll()) {
    if (exclude.includes(s.cwd)) continue;
    const g = byCwd.get(s.cwd) ?? { path: s.cwd, providers: [], sessionCount: 0, lastActive: s.updatedAt };
    g.sessionCount++;
    if (!g.providers.includes(s.provider)) g.providers.push(s.provider);
    if (s.updatedAt > g.lastActive) g.lastActive = s.updatedAt;
    byCwd.set(s.cwd, g);
  }
  return [...byCwd.values()].sort((a, b) => b.lastActive.localeCompare(a.lastActive)).slice(0, 30);
}
