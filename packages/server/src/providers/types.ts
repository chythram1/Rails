import type { ProviderId } from "@rails/shared";

/** One session found in a provider's on-disk store. */
export interface DiscoveredSession {
  provider: ProviderId;
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Finds a provider's sessions on disk (see docs/CONTEXT.md "Adapter"). */
export interface DiscoveryAdapter {
  id: ProviderId;
  name: string;
  available(): boolean;
  scan(): Promise<DiscoveredSession[]>;
}
