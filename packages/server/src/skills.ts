// Skills an agent profile can load (ADR 0018): folders with a SKILL.md, found in Rails' skill library, the
// user's own skill folders and the project's. Read-only except for importing into the library. Discovery reads
// only the start of each SKILL.md (its front matter), cached by mtime and size, so it stays cheap.
import { cp, open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SkillInfo, SkillRef, SkillSource } from "@rails/shared";
import { AGENTS_HOME, CLAUDE_HOME, SKILLS_DIR } from "./config.ts";
import { ServiceError } from "./errors.ts";
import { pickFolder } from "./picker.ts";

/** Where each source looks, in order: the first folder with a skill of a given name wins. */
function folders(source: SkillSource, projectPath?: string): string[] {
  switch (source) {
    case "library":
      return [SKILLS_DIR];
    case "user":
      return [join(CLAUDE_HOME, "skills"), join(AGENTS_HOME, "skills")];
    case "project":
      return projectPath ? [join(projectPath, ".claude", "skills"), join(projectPath, ".agents", "skills")] : [];
  }
}

/** A skill's folder name, which is also its name in a profile. Never a path. */
export const validSkillName = (name: unknown): name is string => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && name.length <= 100;

const HEAD_BYTES = 8192;
const cache = new Map<string, { mtimeMs: number; size: number; meta: Meta | null }>();
type Meta = { description: string; manual: boolean };

/** The front matter's description and `disable-model-invocation`, or null without front matter. */
export function parseFrontMatter(text: string): Meta | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      // A block scalar: the indented lines after it.
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      value = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    fields[kv[1]] = value;
  }
  return { description: fields.description ?? "", manual: fields["disable-model-invocation"] === "true" };
}

async function readMeta(file: string): Promise<Meta | null> {
  let s;
  try {
    s = await stat(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === s.mtimeMs && hit.size === s.size) return hit.meta;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, s.size));
    await fh.read(buf, 0, buf.length, 0);
    const meta = parseFrontMatter(buf.toString("utf8"));
    cache.set(file, { mtimeMs: s.mtimeMs, size: s.size, meta });
    return meta;
  } finally {
    await fh.close();
  }
}

async function scanSource(source: SkillSource, projectPath?: string): Promise<SkillInfo[]> {
  const found = new Map<string, SkillInfo>();
  for (const folder of folders(source, projectPath)) {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      continue; // the folder doesn't exist
    }
    for (const name of names.sort()) {
      if (found.has(name) || !validSkillName(name)) continue;
      const meta = await readMeta(join(folder, name, "SKILL.md"));
      if (meta) found.set(name, { ref: { source, name }, ...meta });
    }
  }
  return [...found.values()];
}

/**
 * Every skill a profile can pick: the library's, the user's, and each project's. A project skill found in several
 * projects is listed once, with their names.
 */
export async function listSkills(projects: { name: string; path: string }[] = []): Promise<SkillInfo[]> {
  const [library, user, ...perProject] = await Promise.all([scanSource("library"), scanSource("user"), ...projects.map((p) => scanSource("project", p.path))]);
  const shared = new Map<string, SkillInfo & { projects: string[] }>();
  perProject.forEach((list, i) => {
    for (const skill of list) {
      const seen = shared.get(skill.ref.name);
      if (seen) seen.projects.push(projects[i].name);
      else shared.set(skill.ref.name, { ...skill, projects: [projects[i].name] });
    }
  });
  return [...library, ...user, ...shared.values()];
}

/** The folder of a skill a profile refers to, or null if it can't be found (here). */
export async function resolveSkill(ref: SkillRef, projectPath?: string): Promise<string | null> {
  if (!validSkillName(ref.name)) return null;
  for (const folder of folders(ref.source, projectPath)) {
    const dir = join(folder, ref.name);
    if (await readMeta(join(dir, "SKILL.md"))) return dir;
  }
  return null;
}

/**
 * Copy a skill folder into the library, picked with the native folder picker (on the server's screen, ADR 0004).
 * Null when the user cancels.
 */
export async function importSkill(): Promise<SkillInfo | null> {
  const from = await pickFolder();
  if (!from) return null;
  const name = basename(from);
  const meta = await readMeta(join(from, "SKILL.md"));
  if (!meta) throw new ServiceError("That folder has no SKILL.md with front matter. Pick a skill's own folder.", 400);
  if (!validSkillName(name)) throw new ServiceError("Skill folder names can use letters, numbers, dots, dashes and underscores.", 400);
  const to = join(SKILLS_DIR, name);
  if (await stat(to).catch(() => null)) throw new ServiceError(`The library already has a skill called ${name}.`, 409);
  await cp(from, to, { recursive: true });
  return { ref: { source: "library", name }, ...meta };
}
