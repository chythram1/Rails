import type { Project, Sprocket } from "@rails/shared";
import { describe, expect, it } from "vitest";
import { groupSprockets } from "./groups.ts";

const look = { character: "cog", color: "green", accessory: "none" } as const;
const sp = (id: string, projectId: string | undefined, at: string, coordinator = false): Sprocket => ({
  id, name: id, look, createdAt: at, projectId, description: "", coordinator, rules: [], pending: [], running: false,
});
const projects: Project[] = [
  { id: "a", name: "app", path: "/a", createdAt: "" },
  { id: "b", name: "lib", path: "/b", createdAt: "" },
];

describe("groupSprockets", () => {
  const list = [sp("old", "a", "2026-10-01"), sp("lead", "a", "2026-09-01", true), sp("new", "a", "2026-10-09"), sp("free", undefined, "2026-10-02"), sp("lost", "gone", "2026-10-03")];

  it("groups by project in the sidebar's order, General last, Coordinator first, then the most recent", () => {
    expect(groupSprockets(list, projects).map((g) => [g.title, g.list.map((s) => s.id)])).toEqual([
      ["app", ["lead", "new", "old"]],
      ["General", ["lost", "free"]], // a Sprocket whose project is gone counts as unattached
    ]);
  });

  it("keeps only the chosen group", () => {
    expect(groupSprockets(list, projects, "general").map((g) => g.key)).toEqual(["general"]);
    expect(groupSprockets(list, projects, "b")).toEqual([]);
  });
});
