import { useMemo } from "react";
import { scheduleText, type AutomationSchedule } from "@rails/shared";
import { Dropdown } from "../Dropdown.tsx";
import { Segmented } from "../Segmented.tsx";

type Kind = AutomationSchedule["kind"];
const KINDS: { value: Kind; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "cron", label: "Custom" },
];
/** Monday first, as calendars here start; the schedule counts from Sunday (0). */
const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: d, short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d], long: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d] }));

const timeOf = (s: AutomationSchedule) => ("time" in s ? s.time : s.kind === "once" ? s.at.slice(11, 16) : "09:00");

/** The same moment as cron fields, so Custom starts from what was chosen. */
function asCron(s: AutomationSchedule): string {
  const [h, m] = timeOf(s).split(":").map(Number);
  switch (s.kind) {
    case "hourly":
      return `${s.minute} * * * *`;
    case "weekdays":
      return `${m} ${h} * * 1-5`;
    case "weekly":
      return `${m} ${h} * * ${[...s.days].sort().join(",")}`;
    case "cron":
      return s.expr;
    default:
      return `${m} ${h} * * *`;
  }
}

/** Switching kind keeps the time where it can. */
function switchTo(kind: Kind, s: AutomationSchedule): AutomationSchedule {
  const time = timeOf(s);
  switch (kind) {
    case "once": {
      const tomorrow = new Date(Date.now() + 86_400_000);
      const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
      return { kind, at: `${date}T${time}` };
    }
    case "hourly":
      return { kind, minute: 0 };
    case "weekly":
      return { kind, days: s.kind === "weekly" ? s.days : [1], time };
    case "cron":
      return { kind, expr: asCron(s) };
    default:
      return { kind, time };
  }
}

const zones = (current: string): string[] => {
  const all: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  return all.includes(current) ? all : [current, ...all];
};

/**
 * When an automation runs (ADR 0032): Once, Hourly, Daily, Weekdays, Weekly or Custom (cron), the fields that kind
 * needs, the timezone, and the schedule in words under it. `id` prefixes its controls' ids.
 */
export function ScheduleField({ id, schedule, timezone, onChange }: { id: string; schedule: AutomationSchedule; timezone: string; onChange(schedule: AutomationSchedule, timezone: string): void }) {
  const set = (s: AutomationSchedule) => onChange(s, timezone);
  const options = useMemo(() => zones(timezone).map((z) => ({ value: z, label: z.replace(/_/g, " ") })), [timezone]);
  const s = schedule;
  return (
    <div className="au-schedule">
      <span id={`${id}-kind`} className="sr-only">
        How often
      </span>
      <Segmented name={`${id}-kind`} aria-labelledby={`${id}-kind`} value={s.kind} options={KINDS} onChange={(k) => set(switchTo(k, s))} />
      <div className="au-schedule-fields">
        {s.kind === "once" && (
          <label className="au-field">
            <span>On</span>
            <input type="datetime-local" className="input" value={s.at} onChange={(e) => set({ kind: "once", at: e.target.value })} />
          </label>
        )}
        {s.kind === "hourly" && (
          <label className="au-field">
            <span>At minute</span>
            <input
              type="number"
              className="input au-minute"
              min={0}
              max={59}
              value={s.minute}
              onChange={(e) => set({ kind: "hourly", minute: Math.max(0, Math.min(59, Math.trunc(Number(e.target.value) || 0))) })}
            />
          </label>
        )}
        {s.kind === "weekly" && (
          <div className="au-field" role="group" aria-labelledby={`${id}-days`}>
            <span id={`${id}-days`}>On</span>
            <div className="au-days">
              {DAYS.map((d) => {
                const on = s.days.includes(d.day);
                return (
                  <button
                    key={d.day}
                    type="button"
                    className="au-day"
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => set({ ...s, days: on ? s.days.filter((x) => x !== d.day) : [...s.days, d.day] })}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {(s.kind === "daily" || s.kind === "weekdays" || s.kind === "weekly") && (
          <label className="au-field">
            <span>At</span>
            <input type="time" className="input" value={s.time} onChange={(e) => e.target.value && set({ ...s, time: e.target.value })} />
          </label>
        )}
        {s.kind === "cron" && (
          <label className="au-field au-field-wide">
            <span>Cron</span>
            <input className="input cz-mono" value={s.expr} spellCheck={false} onChange={(e) => set({ kind: "cron", expr: e.target.value })} aria-describedby={`${id}-cron-help`} />
            <small id={`${id}-cron-help`} className="muted">
              Minute, hour, day of month, month, weekday. At most every 15 minutes.
            </small>
          </label>
        )}
        <div className="au-field au-field-zone">
          <label htmlFor={`${id}-zone`}>Timezone</label>
          <Dropdown id={`${id}-zone`} value={timezone} options={options} onChange={(z) => onChange(s, z)} />
        </div>
      </div>
      <p className="muted small au-schedule-words">
        {s.kind === "weekly" && !s.days.length ? "Pick at least one day." : `${scheduleText(s)}, ${timezone.replace(/_/g, " ")} time.`}
      </p>
    </div>
  );
}
