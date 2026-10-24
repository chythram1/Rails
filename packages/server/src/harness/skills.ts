// read_skill (ADR 0025): a Sprocket reads one of its skills, SKILL.md or a file beside it. Its instructions list the
// skills it has (skillsPrompt), so it knows when one applies.
import { Type } from "@earendil-works/pi-ai";
import type { Skill } from "@rails/shared";
import { readSkillFile } from "../customize/skills.ts";
import type { Capability } from "./capabilities.ts";

/** The lines its instructions get: each skill's name and description. */
export function skillsPrompt(skills: Skill[]): string[] {
  if (!skills.length) return [];
  return [
    "Skills you have: instructions your user gave you for particular kinds of work. When one applies, read it with read_skill before you start, and follow it. You can't run a skill's scripts, only read its files.",
    ...skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`),
  ];
}

export function readSkillCapability(skills: Skill[]): Capability {
  return {
    name: "read_skill",
    description: `Read one of your skills: its SKILL.md, or with \`file\` another file in it (as SKILL.md names it). Your skills: ${skills.map((s) => s.name).join(", ")}.`,
    params: Type.Object({
      name: Type.String({ description: "The skill's name." }),
      file: Type.Optional(Type.String({ description: "A file in the skill, relative to its folder. Leave out for SKILL.md." })),
    }),
    effect: "read",
    log: { doing: (a) => `Reading the skill ${a.name}`, done: (calls) => `read the skill${calls.length > 1 ? "s" : ""} ${[...new Set(calls.map((c) => c.name))].join(", ")}` },
    run: async ({ name, file }: { name: string; file?: string }) => {
      const skill = skills.find((s) => s.name.toLowerCase() === name.trim().toLowerCase() || s.id === name.trim());
      if (!skill) throw new Error(`You have no skill called ${JSON.stringify(name)}. Yours: ${skills.map((s) => s.name).join(", ")}.`);
      return readSkillFile(skill.id, file);
    },
  };
}
