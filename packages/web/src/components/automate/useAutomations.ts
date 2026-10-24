import type { Automation, AutomationOutcome, AutomationRun } from "@rails/shared";
import { api } from "../../api.ts";
import { useLive } from "../ui/useLive.ts";

/** Every automation (ADR 0032), kept current: the server says when they or their runs change. */
export function useAutomations(): { list: Automation[] | null; error: string } {
  const { data: list, error } = useLive(api.automations, (m) => m.type === "automations.changed");
  return { list, error };
}

/** One automation and its runs, kept current; `missing` once it's gone (deleted, maybe on another device). */
export function useAutomation(id: string): { data: { automation: Automation; runs: AutomationRun[] } | null; missing: boolean } {
  const { data, error } = useLive(() => api.automation(id), (m) => m.type === "automations.changed", { key: id });
  return { data, missing: error === "Not found" };
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

/** When it runs next, short: "Today 9:00 AM", "Tomorrow 9:00 AM", "Mon 9:00 AM", "Oct 30 9:00 AM", in the browser's time. */
export function soon(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

/** How long a run took: "8s", "3m", "1h 5m". */
export function took(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The share of ended runs that didn't fail, as "92%"; none before a run has ended. */
export const successRate = (ended: number, failed: number) => (ended ? `${Math.round(((ended - failed) / ended) * 100)}%` : undefined);
