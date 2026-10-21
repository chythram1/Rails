import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS_HOME, CLAUDE_HOME, SKILLS_DIR } from "./config.ts";
import { listSkills, parseFrontMatter, resolveSkill } from "./skills.ts";

function skill(folder: string, name: string, text: string) {
  mkdirSync(join(folder, name), { recursive: true });
  writeFileSync(join(folder, name, "SKILL.md"), text);
}

describe("parseFrontMatter", () => {
  it("reads a plain, a quoted and a folded description, and the manual flag", () => {
    expect(parseFrontMatter("---\nname: a\ndescription: Plain words.\n---\nbody")).toEqual({ description: "Plain words.", manual: false });
    expect(parseFrontMatter('---\ndescription: "Quoted: yes"\ndisable-model-invocation: true\n---\n')).toEqual({ description: "Quoted: yes", manual: true });
    expect(parseFrontMatter("---\ndescription: >\n  Folded over\n  two lines.\nname: b\n---\n")?.description).toBe("Folded over two lines.");
  });

  it("is null without front matter", () => {
    expect(parseFrontMatter("# Just a heading")).toBeNull();
  });
});

describe("listSkills", () => {
  const project = mkdtempSync(join(tmpdir(), "rails-skills-project-"));
  skill(SKILLS_DIR, "lib-one", "---\ndescription: From the library.\n---\n");
  skill(join(CLAUDE_HOME, "skills"), "shared", "---\ndescription: Claude's copy.\n---\n");
  skill(join(AGENTS_HOME, "skills"), "shared", "---\ndescription: The agents' copy.\n---\n");
  skill(join(AGENTS_HOME, "skills"), "broken", "no front matter here");
  skill(join(project, ".agents", "skills"), "proj-only", "---\ndescription: Only here.\n---\n");

  it("finds each source, skips folders without front matter, and prefers ~/.claude over ~/.agents", async () => {
    const all = await listSkills([{ id: "p1", name: "app", path: project }, { id: "p2", name: "copy", path: project }]);
    const by = (source: string, name: string) => all.find((s) => s.ref.source === source && s.ref.name === name);
    expect(by("library", "lib-one")?.description).toBe("From the library.");
    expect(by("user", "shared")?.description).toBe("Claude's copy.");
    expect(all.filter((s) => s.ref.name === "shared")).toHaveLength(1);
    expect(by("user", "broken")).toBeUndefined();
    expect(by("project", "proj-only")?.projects).toEqual(["app", "copy"]);
    expect(by("project", "proj-only")?.projectIds).toEqual(["p1", "p2"]);
  });

  it("resolves a project skill only in its project", async () => {
    expect(await resolveSkill({ source: "project", name: "proj-only" }, project)).toBe(join(project, ".agents", "skills", "proj-only"));
    expect(await resolveSkill({ source: "project", name: "proj-only" }, "/somewhere/else")).toBeNull();
    expect(await resolveSkill({ source: "library", name: "../lib-one" })).toBeNull();
  });
});
