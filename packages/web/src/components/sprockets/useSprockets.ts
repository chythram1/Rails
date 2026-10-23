import type { Sprocket, SprocketTeam } from "@rails/shared";
import { api } from "../../api.ts";
import { useLive } from "../useLive.ts";

/** All of the user's Sprockets and their team chats (ADR 0022), kept current (the server says when they or their chats change). */
export function useSprockets(): { list: Sprocket[] | null; teams: SprocketTeam[]; error: string } {
  const { data, error } = useLive(
    async () => {
      const [list, teams] = await Promise.all([api.sprockets(), api.teams()]);
      return { list, teams };
    },
    (m) => m.type === "sprockets.changed",
  );
  return { list: data?.list ?? null, teams: data?.teams ?? [], error };
}
