// When automations run (ADR 0032): a schedule in a timezone becomes a cron pattern (or one date and time), and Rails
// keeps only the next time it fires. After the server was down that time is past, so it runs once and the next is
// counted from then: never once per missed time, and never for times before it existed.
import { Cron } from "croner";
import { AUTOMATION_MIN_MINUTES, type AutomationSchedule } from "@rails/shared";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** The schedule as croner reads it: five cron fields, or for `once` its local date and time. */
function pattern(s: AutomationSchedule): string {
  const at = (time: string) => {
    const [, h, m] = TIME.exec(time)!;
    return `${Number(m)} ${Number(h)}`;
  };
  switch (s.kind) {
    case "once":
      return `${s.at}:00`;
    case "hourly":
      return `${s.minute} * * * *`;
    case "daily":
      return `${at(s.time)} * * *`;
    case "weekdays":
      return `${at(s.time)} * * 1-5`;
    case "weekly":
      return `${at(s.time)} * * ${[...new Set(s.days)].sort().join(",")}`;
    case "cron":
      return s.expr.trim();
  }
}

/** Whether `timezone` is one this server knows. */
export function knownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function cron(s: AutomationSchedule, timezone: string): Cron {
  return new Cron(pattern(s), { timezone, paused: true });
}

/** What's wrong with a schedule, in words the form can show; undefined when it's fine. */
export function scheduleProblem(s: AutomationSchedule, timezone: string, now = new Date()): string | undefined {
  if (!knownTimezone(timezone)) return `There's no timezone called ${JSON.stringify(timezone)}.`;
  switch (s.kind) {
    case "once":
      if (!LOCAL.test(s.at)) return "Pick a date and a time.";
      break;
    case "hourly":
      if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute > 59) return "Pick a minute from 0 to 59.";
      break;
    case "weekly":
      if (!Array.isArray(s.days) || !s.days.length || s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Pick at least one day.";
      if (!TIME.test(s.time)) return "Pick a time.";
      break;
    case "daily":
    case "weekdays":
      if (!TIME.test(s.time)) return "Pick a time.";
      break;
    case "cron":
      if (typeof s.expr !== "string" || s.expr.trim().split(/\s+/).length !== 5) return "A cron expression has five fields: minute, hour, day of month, month and weekday.";
      break;
    default:
      return "Pick a schedule.";
  }
  let c: Cron;
  try {
    c = cron(s, timezone);
  } catch (e) {
    return `That cron expression doesn't work: ${(e as Error).message}`;
  }
  const next = c.nextRuns(10, now);
  if (!next.length) return s.kind === "once" ? "That time has passed." : "That schedule never runs.";
  for (let i = 1; i < next.length; i++)
    if (next[i].getTime() - next[i - 1].getTime() < AUTOMATION_MIN_MINUTES * 60_000) return `Automations can run at most every ${AUTOMATION_MIN_MINUTES} minutes.`;
  return undefined;
}

/** The first time the schedule fires after `after`, or undefined if it never does again. */
export function nextRun(s: AutomationSchedule, timezone: string, after = new Date()): Date | undefined {
  try {
    return cron(s, timezone).nextRun(after) ?? undefined;
  } catch {
    return undefined;
  }
}
