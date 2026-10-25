import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { RAILS_HOME } from "./config.ts";
import { panels, projects, sessionEvents, settings, sprocketChats, sprockets, tx } from "./db.ts";
import { createSprocket } from "./sprockets/sprockets.ts";

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

describe("transactions", () => {
  it("undoes every write of one that throws, nested ones too", () => {
    expect(() =>
      tx(() => {
        settings.set("tx-test", "1");
        tx(() => settings.set("tx-test-inner", "1")); // joins the outer one
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(settings.get("tx-test")).toBeUndefined();
    expect(settings.get("tx-test-inner")).toBeUndefined();
  });

  it("deletes a Sprocket whole, with the team it was the last member of", () => {
    const s = createSprocket({ name: "Solo", look: { character: "blob", color: "teal" } });
    const team = sprocketChats.createTeam("Just me", [s.id]);
    sprockets.remove(s.id);
    expect(sprockets.get(s.id)).toBeUndefined();
    expect(sprocketChats.get(team.id)).toBeUndefined();
    expect(sprocketChats.of(s.id, "direct")).toBeUndefined();
  });
});
