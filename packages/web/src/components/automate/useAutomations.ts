import { useCallback, useEffect, useState } from "react";
import type { Automation, AutomationOutcome, AutomationRun } from "@rails/shared";
import { api } from "../../api.ts";
import { socket } from "../../ws.ts";

/** Every automation (ADR 0032), kept current: the server says when they or their runs change. */
export function useAutomations(): { list: Automation[] | null; error: string } {
  const [list, setList] = useState<Automation[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setList(await api.automations());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "automations.changed") void load();
    });
  }, [load]);
  return { list, error };
}

/** One automation and its runs, kept current; `missing` once it's gone (deleted, maybe on another device). */
export function useAutomation(id: string): { data: { automation: Automation; runs: AutomationRun[] } | null; missing: boolean } {
  const [data, setData] = useState<{ automation: Automation; runs: AutomationRun[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api.automation(id));
      setMissing(false);
    } catch (e: any) {
      if (e.message === "Not found") setMissing(true);
    }
  }, [id]);
  useEffect(() => {
    setData(null);
    void load();
    return socket.on((m) => {
      if (m.type === "automations.changed") void load();
    });
  }, [load]);
  return { data, missing };
}

/** A run's outcome in words, and the state its dot shows (DESIGN.md: a state color always comes with its word). */
export const OUTCOME: Record<AutomationOutcome, { label: string; tone: "ok" | "busy" | "needed" | "idle" }> = {
  running: { label: "Running", tone: "busy" },
  done: { label: "Done", tone: "ok" },
  quiet: { label: "Nothing new", tone: "idle" },
  needs_you: { label: "Needs you", tone: "needed" },
  failed: { label: "Failed", tone: "needed" },
  skipped: { label: "Skipped", tone: "idle" },
};

/** "Mon, Oct 26, 09:00", in the browser's own time. */
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The browser's timezone, for a new automation. */
export const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
