import { useCallback, useEffect, useState } from "react";
import type { Sprocket, SprocketGroup } from "@rails/shared";
import { api } from "../../api.ts";
import { socket } from "../../ws.ts";

/** All of the user's Sprockets and their group chats (ADR 0022), kept current (the server says when they or their chats change). */
export function useSprockets(): { list: Sprocket[] | null; groups: SprocketGroup[]; error: string } {
  const [data, setData] = useState<{ list: Sprocket[]; groups: SprocketGroup[] } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, groups] = await Promise.all([api.sprockets(), api.groups()]);
      setData({ list, groups });
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

  return { list: data?.list ?? null, groups: data?.groups ?? [], error };
}
