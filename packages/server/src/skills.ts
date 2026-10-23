// Skills for Sprockets (ADR 0025): SKILL.md folders in RAILS_HOME/skills/<id>/, the folder name being the id. Written
// in Customize, or copied in from a folder: one the user picks, or one their agents already have. A Sprocket's
// instructions list the skills it has; read_skill (harness/skills.ts) reads one. Sprockets can't run their scripts.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, normalize, relative, sep } from "node:path";
import { SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX, type Skill, type SkillInput, type SkillSource } from "@rails/shared";
import { RAILS_HOME } from "./config.ts";
import { customizeChanged } from "./customize.ts";
import { sprocketTools } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { pickFolder } from "./picker.ts";

const dir = () => join(RAILS_HOME, "skills");
/** At most this many files are listed (and copied in) per skill, and this much in all. */
const FILES_MAX = 200;
const COPY_MAX_BYTES = 5_000_000;
/** A file a Sprocket reads is cut at this. */
const READ_MAX = 100_000;
const ID = /^[a-z0-9][a-z0-9-]*$/;

// ---- SKILL.md ----

/** A SKILL.md's front matter (only simple `key: value` lines, folded and quoted values) and its body. */
export function parseSkill(md: string): { name: string; description: string; extra: string[]; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name: "", description: "", extra: [], body: md.trim() };
  const lines = m[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  const extra: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    // A block (`>` or `|`) or continuation lines: the indented lines that follow.
    const more: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
    if (key !== "name" && key !== "description") {
      extra.push(lines.slice(i - more.length, i + 1).join("\n"));
      continue;
    }
    let value = /^[>|][-+]?$/.test(raw.trim()) ? more.join(raw.trim().startsWith("|") ? "\n" : " ") : [raw, ...more].join(" ").trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1).replace(/\\"/g, '"');
    fields[key] = value.trim();
  }
  return { name: fields.name ?? "", description: fields.description ?? "", extra, body: m[2].trim() };
}

const quote = (v: string) => JSON.stringify(v);
const writeMd = (path: string, name: string, description: string, extra: string[], body: string) =>
  writeFileSync(path, `---\nname: ${quote(name)}\ndescription: ${quote(description)}\n${extra.map((e) => e + "\n").join("")}---\n\n${body.trim()}\n`);

/** The files beside SKILL.md, relative to the folder (no dot folders), up to FILES_MAX. */
function filesIn(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (out.length >= FILES_MAX) return;
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && p !== join(root, "SKILL.md")) out.push(relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

function read(id: string): Skill | undefined {
  const md = join(dir(), id, "SKILL.md");
  if (!ID.test(id) || !existsSync(md)) return undefined;
  const p = parseSkill(readFileSync(md, "utf8"));
  return { id, name: p.name || id, description: p.description, body: p.body, files: filesIn(join(dir(), id)), usedBy: sprocketTools.users("skill", id), updatedAt: statSync(md).mtime.toISOString() };
}

export const skillExists = (id: string) => !!read(id);

export function listSkills(): Skill[] {
  if (!existsSync(dir())) return [];
  return readdirSync(dir())
    .flatMap((id) => read(id) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getSkill(id: string): Skill {
  const s = read(id);
  if (!s) throw new ServiceError("Not found", 404);
  return s;
}

/** A folder name from a skill's name: "PDF tools" → "pdf-tools", then "-2"… if taken. */
function freeId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "skill";
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(join(dir(), id))) return id;
  }
}

function parseInput(b: SkillInput, cur?: Skill): { name: string; description: string; body: string } {
  const name = (b.name ?? cur?.name ?? "New skill").trim();
  const description = (b.description ?? cur?.description ?? "").trim();
  const body = b.body ?? cur?.body ?? "";
  if (typeof name !== "string" || !name) throw new ServiceError("Give it a name.", 400);
  if (name.length > SKILL_NAME_MAX) throw new ServiceError(`Names can be at most ${SKILL_NAME_MAX} characters.`, 400);
  if (/[\n\r]/.test(name) || /[\n\r]/.test(description)) throw new ServiceError("The name and description are one line each.", 400);
  if (description.length > SKILL_DESCRIPTION_MAX) throw new ServiceError(`Descriptions can be at most ${SKILL_DESCRIPTION_MAX} characters.`, 400);
  if (typeof body !== "string" || body.length > SKILL_BODY_MAX) throw new ServiceError(`A skill can be at most ${SKILL_BODY_MAX} characters.`, 400);
  return { name, description, body };
}

export function createSkill(body: SkillInput | undefined): Skill {
  const { name, description, body: text } = parseInput(body ?? {});
  const id = freeId(name);
  mkdirSync(join(dir(), id), { recursive: true });
  writeMd(join(dir(), id, "SKILL.md"), name, description, [], text);
  customizeChanged();
  return getSkill(id);
}

export function updateSkill(id: string, body: SkillInput | undefined): Skill {
  const cur = getSkill(id);
  const { name, description, body: text } = parseInput(body ?? {}, cur);
  const md = join(dir(), id, "SKILL.md");
  writeMd(md, name, description, parseSkill(readFileSync(md, "utf8")).extra, text);
  customizeChanged();
  return getSkill(id);
}

/** Delete Rails' copy (the folder it was copied from stays where it was). */
export function deleteSkill(id: string): void {
  getSkill(id);
  rmSync(join(dir(), id), { recursive: true, force: true });
  sprocketTools.dropSkill(id);
  customizeChanged();
}

// ---- copying skills in ----

/** Where the user's agents keep skills. */
const SOURCES = [
  { from: "~/.agents/skills", path: () => join(homedir(), ".agents", "skills") },
  { from: "~/.claude/skills", path: () => join(homedir(), ".claude", "skills") },
  { from: "~/.pi/agent/skills", path: () => join(homedir(), ".pi", "agent", "skills") },
];

/** The skills the user's agents have (one level down in each place), by name and description only. */
export function skillSources(): SkillSource[] {
  return SOURCES.flatMap(({ from, path }) => {
    const root = path();
    if (!existsSync(root)) return [];
    return readdirSync(root).flatMap((entry): SkillSource[] => {
      const folder = join(root, entry);
      const md = join(folder, "SKILL.md");
      try {
        if (!statSync(folder).isDirectory() || !existsSync(md)) return [];
        const p = parseSkill(readFileSync(md, "utf8").slice(0, 20_000));
        return [{ path: folder, name: p.name || entry, description: p.description.slice(0, 300), from }];
      } catch {
        return [];
      }
    });
  });
}

/** Copy a skill folder in: `path` (one of skillSources'), or a folder the user picks on the server. Null if they cancel. */
export async function importSkill(path?: unknown): Promise<Skill | null> {
  let from: string;
  if (path === undefined) {
    const picked = await pickFolder();
    if (!picked) return null;
    from = picked;
  } else {
    if (typeof path !== "string" || !skillSources().some((s) => s.path === path)) throw new ServiceError("That isn't one of your agents' skills.", 400);
    from = path;
  }
  if (!existsSync(join(from, "SKILL.md"))) throw new ServiceError(`${basename(from)} has no SKILL.md, so it isn't a skill.`, 400);
  const p = parseSkill(readFileSync(join(from, "SKILL.md"), "utf8"));
  // What would be copied: regular files only (no links out of the folder), within the limits.
  let bytes = 0;
  let count = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const st = lstatSync(join(d, e));
      if (st.isDirectory()) walk(join(d, e));
      else if (st.isFile()) {
        bytes += st.size;
        count++;
      }
    }
  };
  walk(from);
  if (bytes > COPY_MAX_BYTES || count > FILES_MAX) throw new ServiceError(`That skill is too big to copy in (at most ${FILES_MAX} files and 5 MB).`, 400);
  const id = freeId(p.name || basename(from));
  cpSync(from, join(dir(), id), {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return src === from || (!name.startsWith(".") && name !== "node_modules" && !lstatSync(src).isSymbolicLink());
    },
  });
  customizeChanged();
  return getSkill(id);
}

// ---- reading, for Sprockets ----

/** A file of a skill: SKILL.md (all of it) or one beside it. Text only, cut at READ_MAX. */
export function readSkillFile(id: string, file?: string): string {
  const root = join(dir(), id);
  const rel = normalize(file?.trim() || "SKILL.md");
  if (rel.startsWith("..") || rel.startsWith(sep) || rel.split(sep).some((p) => p.startsWith("."))) throw new Error(`${file} isn't a file of this skill.`);
  const path = join(root, rel);
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`The skill has no file ${rel}. Its files: SKILL.md${filesIn(root).map((f) => `, ${f}`).join("")}.`);
  const buf = readFileSync(path);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} isn't text.`);
  const text = buf.toString("utf8");
  return text.length > READ_MAX ? `${text.slice(0, READ_MAX)}\n[…cut from ${text.length} characters]` : text;
}
