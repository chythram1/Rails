import type { Message, ProviderId } from "@rails/shared";

/** One session found in a provider's on-disk store. */
export interface DiscoveredSession {
  provider: ProviderId;
  id: string;
  cwd: string;
  file: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** Read-only side of an adapter (see docs/CONTEXT.md "Adapter"). */
export interface DiscoveryAdapter {
  id: ProviderId;
  name: string;
  available(): boolean;
  scan(): Promise<DiscoveredSession[]>;
  readTranscript(file: string): Promise<Message[]>;
}
