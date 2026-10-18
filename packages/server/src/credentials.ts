// Model provider credentials (API keys, OAuth tokens) for Sprockets (ADR 0006). They live in one file in
// RAILS_HOME, readable only by the user, and never leave the server: the API only reports which providers
// are set up. Panel processes never see them (tmux.ts cleans the environment).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { RAILS_HOME } from "./config.ts";

type Stored = Record<string, Credential>;

/** A CredentialStore backed by `file`. Writes are serialized, so an OAuth refresh can't race a login. */
export function fileCredentialStore(file = join(RAILS_HOME, "credentials.json")): CredentialStore {
  const read = (): Stored => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Stored) : {});
  const write = (data: Stored) => {
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file); // atomic: a crash never leaves a half-written file
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  return {
    async read(providerId) {
      return read()[providerId];
    },
    async list(): Promise<CredentialInfo[]> {
      return Object.entries(read()).map(([providerId, c]) => ({ providerId, type: c.type }));
    },
    modify(providerId, fn) {
      return serial(async () => {
        const next = await fn(read()[providerId]);
        if (next === undefined) return read()[providerId];
        write({ ...read(), [providerId]: next });
        return next;
      });
    },
    delete(providerId) {
      return serial(async () => {
        const data = read();
        delete data[providerId];
        write(data);
      });
    },
  };
}
