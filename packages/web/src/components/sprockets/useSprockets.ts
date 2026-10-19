import { useCallback, useEffect, useState } from "react";
import type { Sprocket } from "@rails/shared";
import { api } from "../../api.ts";
import { socket } from "../../ws.ts";

/** All of the user's Sprockets, kept current (the server says when they or their chats change). */
export function useSprockets(): { list: Sprocket[] | null; error: string } {
  const [list, setList] = useState<Sprocket[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setList(await api.sprockets());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
    });
  }, [load]);

  return { list, error };
}
