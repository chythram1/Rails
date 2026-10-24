import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMsg } from "@rails/shared";
import { socket } from "../ws.ts";

/**
 * Something from the server, kept current: loaded now, again whenever `changes` says a server message changed it
 * (possibly on another device), and after a reconnect. An answer that arrives after a newer request's is dropped, so
 * an older one never undoes a newer one. A new `key` (what's loaded, such as an id) starts over without showing the
 * last one's data.
 */
export function useLive<T>(
  fetch: () => Promise<T>,
  changes: (m: ServerMsg) => boolean,
  { key = "", initial = null }: { key?: string; initial?: T | null } = {},
): { data: T | null; error: string; reload(): Promise<void> } {
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState("");
  // The latest callbacks, so callers can pass them inline without reloading on every render.
  const fetchRef = useRef(fetch);
  const changesRef = useRef(changes);
  fetchRef.current = fetch;
  changesRef.current = changes;
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const n = ++latest.current;
    try {
      const next = await fetchRef.current();
      if (n !== latest.current) return;
      setData(next);
      setError("");
    } catch (e: any) {
      if (n === latest.current) setError(e.message);
    }
  }, []);

  const loadedKey = useRef(key);
  useEffect(() => {
    if (loadedKey.current !== key) setData(null); // another key: its own data, not the last one's
    loadedKey.current = key;
    void reload();
    const offMessages = socket.on((m) => {
      if (changesRef.current(m)) void reload();
    });
    // Changes made while the socket was down (a server restart, a phone waking up) sent no message here.
    const offConnection = socket.onConnection((up) => up && void reload());
    return () => {
      offMessages();
      offConnection();
    };
  }, [key, reload]);

  return { data, error, reload };
}
