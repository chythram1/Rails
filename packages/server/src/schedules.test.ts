import { describe, expect, it } from "vitest";
import { scheduleText } from "@rails/shared";
import { nextRun, scheduleProblem } from "./schedules.ts";

const at = (iso: string) => new Date(iso);

describe("schedules", () => {
  it("counts the next time in the automation's timezone", () => {
    // Friday 2026-10-23 20:00 UTC is 16:00 in New York: weekdays at 09:00 there is Monday 13:00 UTC.
    expect(nextRun({ kind: "weekdays", time: "09:00" }, "America/New_York", at("2026-10-23T20:00:00Z"))?.toISOString()).toBe("2026-10-26T13:00:00.000Z");
    expect(nextRun({ kind: "daily", time: "09:00" }, "Europe/Berlin", at("2026-10-23T06:00:00Z"))?.toISOString()).toBe("2026-10-23T07:00:00.000Z");
    expect(nextRun({ kind: "hourly", minute: 15 }, "UTC", at("2026-10-23T06:20:00Z"))?.toISOString()).toBe("2026-10-23T07:15:00.000Z");
    // Sunday and Thursday at 18:30: from a Friday, Sunday comes first.
    expect(nextRun({ kind: "weekly", days: [4, 0], time: "18:30" }, "UTC", at("2026-10-23T12:00:00Z"))?.toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(nextRun({ kind: "cron", expr: "0 9 1 * *" }, "UTC", at("2026-10-23T12:00:00Z"))?.toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });

  it("runs a once schedule once, at its local time", () => {
    const once = { kind: "once" as const, at: "2026-10-24T09:00" };
    expect(nextRun(once, "Europe/Berlin", at("2026-10-23T00:00:00Z"))?.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(nextRun(once, "Europe/Berlin", at("2026-10-24T08:00:00Z"))).toBeUndefined();
  });

  it("refuses schedules that never run, run too often, or don't parse", () => {
    const now = at("2026-10-23T12:00:00Z");
    expect(scheduleProblem({ kind: "weekdays", time: "09:00" }, "UTC", now)).toBeUndefined();
    expect(scheduleProblem({ kind: "cron", expr: "0 0 31 2 *" }, "UTC", now)).toBe("That schedule never runs.");
    expect(scheduleProblem({ kind: "cron", expr: "*/5 * * * *" }, "UTC", now)).toBe("Automations can run at most every 15 minutes.");
    expect(scheduleProblem({ kind: "cron", expr: "*/15 * * * *" }, "UTC", now)).toBeUndefined();
    expect(scheduleProblem({ kind: "cron", expr: "0 9 * *" }, "UTC", now)).toMatch(/five fields/);
    expect(scheduleProblem({ kind: "cron", expr: "0 25 * * *" }, "UTC", now)).toMatch(/doesn't work/);
    expect(scheduleProblem({ kind: "once", at: "2026-10-22T09:00" }, "UTC", now)).toBe("That time has passed.");
    expect(scheduleProblem({ kind: "weekly", days: [], time: "09:00" }, "UTC", now)).toBe("Pick at least one day.");
    expect(scheduleProblem({ kind: "daily", time: "9:00" }, "UTC", now)).toBe("Pick a time.");
    expect(scheduleProblem({ kind: "daily", time: "09:00" }, "Mars/Olympus", now)).toMatch(/no timezone/);
  });

  it("says a schedule in words", () => {
    expect(scheduleText({ kind: "weekdays", time: "09:00" })).toBe("Weekdays at 09:00");
    expect(scheduleText({ kind: "hourly", minute: 5 })).toBe("Every hour at :05");
    expect(scheduleText({ kind: "weekly", days: [0, 4, 1], time: "18:30" })).toBe("Mon, Thu, Sun at 18:30");
    expect(scheduleText({ kind: "once", at: "2026-10-24T09:00" })).toBe("Once, Oct 24 at 09:00");
  });
});
