import { useCallback, useEffect, useState } from "react";
import type { Sprocket, SprocketTeam } from "@rails/shared";
import { api } from "../../api.ts";
import { socket } from "../../ws.ts";

/** All of the user's Sprockets and their team chats (ADR 0022), kept current (the server says when they or their chats change). */
export function useSprockets(): { list: Sprocket[] | null; teams: SprocketTeam[]; error: string } {
  const [data, setData] = useState<{ list: Sprocket[]; teams: SprocketTeam[] } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, teams] = await Promise.all([api.sprockets(), api.teams()]);
      setData({ list, teams });
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

  return { list: data?.list ?? null, teams: data?.teams ?? [], error };
}
