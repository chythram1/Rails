// Signing out and facts about this server (Settings → Account and General). There's one user and one
// access token (ADR 0001); "sign out everywhere" replaces the token, so every other device has to sign in
// again with the new one.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerInfo } from "@rails/shared";
import { HOST, PORT, rotateToken, TOKEN_FROM_ENV } from "./config.ts";
import { ServiceError } from "./errors.ts";
import * as tmux from "./tmux.ts";
import { listeners } from "./util.ts";

const signedOut = listeners();
/** The token was replaced: open connections signed in with the old one should go. */
export const onSignedOutEverywhere = signedOut.on;

/** Replace the access token. Returns the new one, for the device that asked. */
export function signOutEverywhere(): string {
  if (TOKEN_FROM_ENV) throw new ServiceError("The access token is set with RAILS_TOKEN, so Rails can't replace it.", 409);
  const token = rotateToken();
  signedOut.emit();
  return token;
}

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const build = new Promise<string | undefined>((resolve) =>
  execFile("git", ["rev-parse", "--short", "HEAD"], { cwd: repo }, (err, out) => resolve(err ? undefined : out.trim() || undefined)),
);

export async function serverInfo(): Promise<ServerInfo> {
  return {
    host: HOST,
    port: PORT,
    network: !["127.0.0.1", "localhost", "::1"].includes(HOST),
    build: await build,
    tmux: (await tmux.version())?.replace(/^tmux\s+/, "") ?? undefined,
    node: process.version,
    tokenFromEnv: TOKEN_FROM_ENV,
  };
}
