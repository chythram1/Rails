import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { RAILS_HOME } from "./config.ts";
import { panels, projects, sessionEvents } from "./db.ts";

describe("the database file", () => {
  it("takes writes while someone else is reading it (sqlite3 in a terminal, a backup)", () => {
    const project = projects.create("app", `/work/db-${Math.random()}`);
    const panel = panels.create({ projectId: project.id, kind: "pi", title: "pi" });
    const reader = new DatabaseSync(join(RAILS_HOME, "rails.db"));
    try {
      reader.exec("BEGIN");
      reader.prepare("SELECT count(*) FROM session_events").get(); // holds a read open
      expect(() => sessionEvents.add(panel.id, undefined, { kind: "prompt", text: "hi" })).not.toThrow();
      expect(sessionEvents.list(panel.id)).toHaveLength(1);
      expect((reader.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    } finally {
      reader.exec("ROLLBACK");
      reader.close();
    }
  });
});
