import type { ProviderId } from "@rails/shared";

/** One session found in a provider's on-disk store. */
export interface DiscoveredSession {
  provider: ProviderId;
  id: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Its transcript. Server-side only: never sent to browsers. */
  file: string;
}

/** One message of a session's conversation, as a Sprocket reads it. */
export interface TranscriptMessage {
  role: "user" | "agent";
  text: string;
  at?: string;
}

/** Finds a provider's sessions on disk (see docs/CONTEXT.md "Adapter"). */
export interface DiscoveryAdapter {
  id: ProviderId;
  name: string;
  available(): boolean;
  scan(): Promise<DiscoveredSession[]>;
  /** The user's and the agent's messages among some transcript lines, oldest first (no tool calls). */
  messages(lines: any[]): TranscriptMessage[];
}
