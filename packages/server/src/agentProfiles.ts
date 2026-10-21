// Agent profiles (ADR 0020): saved ways to start an agent, turned into command-line flags when a panel starts.
// Rails never writes the agents' own settings; skills reach Claude Code through a plugin folder per panel.
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_PROFILE_DESCRIPTION_MAX,
  AGENT_PROFILE_INSTRUCTIONS_MAX,
  AGENT_PROFILE_NAME_MAX,
  AGENT_PROFILE_TOOLS_MAX,
  EFFORTS,
  PERMISSION_MODES,
  TOOL_PATTERN_MAX,
  type AgentProfile,
  type AgentProfileInput,
  type McpServer,
  type PanelKind,
  type ProfileUse,
  type SkillRef,
} from "@rails/shared";
import { PANEL_PLUGINS_DIR } from "./config.ts";
import { agentProfiles, panels, projects } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { resolveSkill, validSkillName } from "./skills.ts";
import { runningPanels } from "./tmux.ts";
import { listeners } from "./util.ts";

const MAX_SKILLS = 50;
const MAX_SERVERS = 20;
const NEW_NAME = "New agent profile";

// ---- change notifications (the terminal hub forwards these to every browser) ----
const profileChanges = listeners();
export const onAgentProfilesChanged = profileChanges.on;
const changed = profileChanges.emit;

const bad = (message: string) => new ServiceError(message, 400);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A model name: no spaces, and never something that reads as another flag. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,99}$/;

function parseSkills(raw: unknown): SkillRef[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillRef[] = [];
  for (const s of raw) {
    if (!isRecord(s) || !["library", "user", "project"].includes(s.source as string) || !validSkillName(s.name)) throw bad("Unknown skill.");
    if (!out.some((o) => o.source === s.source && o.name === s.name)) out.push({ source: s.source as SkillRef["source"], name: s.name });
  }
  if (out.length > MAX_SKILLS) throw bad(`A profile can have at most ${MAX_SKILLS} skills.`);
  return out;
}

function parseTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = [...new Set(raw.map((t) => str(t).trim()).filter(Boolean))];
  for (const t of out) {
    if (t.length > TOOL_PATTERN_MAX) throw bad(`Tool patterns can be at most ${TOOL_PATTERN_MAX} characters.`);
    // It goes on the command line on its own: a leading dash would read as a flag.
    if (t.startsWith("-") || /[\x00-\x1f]/.test(t)) throw bad(`"${t}" isn't a tool pattern. Use a tool name, like Bash(npm test:*).`);
  }
  if (out.length > AGENT_PROFILE_TOOLS_MAX) throw bad(`A list can have at most ${AGENT_PROFILE_TOOLS_MAX} tool patterns.`);
  return out;
}

function parseStrings(raw: unknown, what: string): Record<string, string> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw bad(`${what} must be names and values.`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.trim()) continue;
    if (typeof v !== "string") throw bad(`${what}: ${k} needs a text value.`);
    out[k.trim()] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseServers(raw: unknown): McpServer[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_SERVERS) throw bad(`A profile can have at most ${MAX_SERVERS} MCP servers.`);
  const out: McpServer[] = [];
  for (const s of raw) {
    if (!isRecord(s)) throw bad("Unknown MCP server.");
    const name = str(s.name).trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) throw bad("MCP server names can use letters, numbers, dashes and underscores (at most 40).");
    if (out.some((o) => o.name === name)) throw bad(`Two MCP servers are called ${name}.`);
    if (s.type === "stdio") {
      const command = str(s.command).trim();
      if (!command) throw bad(`${name} needs a command.`);
      const args = Array.isArray(s.args) ? s.args.map(str).filter((a) => a !== "") : [];
      const env = parseStrings(s.env, `${name}'s environment`);
      if (env && Object.keys(env).some((k) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k))) throw bad(`${name}'s environment has a name that isn't a variable name.`);
      out.push({ name, type: "stdio", command, ...(args.length ? { args } : {}), ...(env ? { env } : {}) });
    } else if (s.type === "http" || s.type === "sse") {
      const url = str(s.url).trim();
      let ok = false;
      try {
        ok = ["http:", "https:"].includes(new URL(url).protocol);
      } catch {}
      if (!ok) throw bad(`${name} needs an http or https URL.`);
      const headers = parseStrings(s.headers, `${name}'s headers`);
      out.push({ name, type: s.type, url, ...(headers ? { headers } : {}) });
    } else {
      throw bad(`${name}: pick Command, HTTP or SSE.`);
    }
  }
  return out;
}

/** A whole profile from a request, checked. Unknown fields are dropped. */
function parseInput(body: Record<string, unknown>, selfId?: string): AgentProfileInput {
  const name = str(body.name).trim();
  if (!name) throw bad("Give it a name.");
  if (name.length > AGENT_PROFILE_NAME_MAX) throw bad(`Names can be at most ${AGENT_PROFILE_NAME_MAX} characters.`);
  const same = agentProfiles.byName(name);
  if (same && same.id !== selfId) throw bad(`Another agent profile is called ${same.name}.`);

  const description = str(body.description).trim();
  if (description.length > AGENT_PROFILE_DESCRIPTION_MAX) throw bad(`Descriptions can be at most ${AGENT_PROFILE_DESCRIPTION_MAX} characters.`);
  // Codex and pi aren't mapped yet (ADR 0020).
  if ((body.provider ?? "claude") !== "claude") throw bad("Agent profiles are for Claude Code for now.");
  const model = str(body.model).trim();
  // No spaces, and never something that reads as another flag.
  if (model && !MODEL.test(model)) throw bad("That doesn't look like a model name, like opus or claude-sonnet-5-5.");
  const effort = str(body.effort);
  if (effort && !(EFFORTS as readonly string[]).includes(effort)) throw bad("Unknown effort level.");
  const permissionMode = str(body.permissionMode);
  if (permissionMode && !(PERMISSION_MODES as readonly string[]).includes(permissionMode)) throw bad("Unknown permission mode.");
  const instructions = str(body.instructions).trimEnd();
  if (instructions.length > AGENT_PROFILE_INSTRUCTIONS_MAX) throw bad(`Instructions can be at most ${AGENT_PROFILE_INSTRUCTIONS_MAX.toLocaleString("en")} characters.`);

  return {
    name,
    description,
    provider: "claude",
    model,
    effort: effort as AgentProfileInput["effort"],
    permissionMode: permissionMode as AgentProfileInput["permissionMode"],
    instructions,
    skills: parseSkills(body.skills),
    allowedTools: parseTools(body.allowedTools),
    disallowedTools: parseTools(body.disallowedTools),
    mcpServers: parseServers(body.mcpServers),
    mcpOnly: body.mcpOnly === true,
    isDefault: body.isDefault === true,
  };
}

/** Only one default per agent: making `p` the default unsets the others. */
function keepOneDefault(p: AgentProfile): void {
  if (!p.isDefault) return;
  for (const other of agentProfiles.list()) {
    if (other.id === p.id || other.provider !== p.provider || !other.isDefault) continue;
    const { id, createdAt: _c, updatedAt: _u, ...rest } = other;
    agentProfiles.update(id, { ...rest, isDefault: false });
  }
}

/**
 * A stored profile with anything that no longer passes the checks dropped (a row saved by an older version, or
 * moved over from the earlier local shape), so a bad value never reaches Claude Code's command line.
 */
function checked(p: AgentProfile): AgentProfile {
  const ok = <T>(parse: () => T): T | undefined => {
    try {
      return parse();
    } catch {
      return undefined;
    }
  };
  const tools = (list: unknown) => (Array.isArray(list) ? list.filter((t) => ok(() => parseTools([t]))?.length === 1) : []);
  const servers = (Array.isArray(p.mcpServers) ? p.mcpServers : []).flatMap((s) => ok(() => parseServers([s])) ?? []);
  return {
    ...p,
    model: typeof p.model === "string" && (!p.model || MODEL.test(p.model)) ? p.model : "",
    effort: (EFFORTS as readonly string[]).includes(p.effort) ? p.effort : "",
    permissionMode: (PERMISSION_MODES as readonly string[]).includes(p.permissionMode) ? p.permissionMode : "",
    instructions: str(p.instructions).slice(0, AGENT_PROFILE_INSTRUCTIONS_MAX),
    skills: (Array.isArray(p.skills) ? p.skills : []).flatMap((s) => ok(() => parseSkills([s])) ?? []),
    allowedTools: tools(p.allowedTools),
    disallowedTools: tools(p.disallowedTools),
    mcpServers: servers.filter((s, i) => servers.findIndex((o) => o.name === s.name) === i),
    mcpOnly: p.mcpOnly === true,
  };
}

export function listAgentProfiles(): AgentProfile[] {
  return agentProfiles.list().map(checked);
}

export function getAgentProfile(id: string): AgentProfile {
  const p = agentProfiles.get(id);
  if (!p) throw new ServiceError("Agent profile not found", 404);
  return checked(p);
}

/** A new profile. Without a name it's called "New agent profile" (numbered when that's taken). */
export function createAgentProfile(body: Record<string, unknown> = {}): AgentProfile {
  let name = str(body.name).trim();
  if (!name) {
    name = NEW_NAME;
    for (let n = 2; agentProfiles.byName(name); n++) name = `${NEW_NAME} ${n}`;
  }
  const p = agentProfiles.create(parseInput({ ...body, name }));
  keepOneDefault(p);
  changed();
  return p;
}

/** A copy of a profile, called "<name> copy" (numbered when that's taken). It's never the default. */
export function duplicateAgentProfile(id: string): AgentProfile {
  const { id: _id, createdAt: _c, updatedAt: _u, ...source } = getAgentProfile(id);
  const base = `${source.name.slice(0, AGENT_PROFILE_NAME_MAX - " copy 99".length)} copy`;
  let name = base;
  for (let n = 2; agentProfiles.byName(name); n++) name = `${base} ${n}`;
  return createAgentProfile({ ...source, name, isDefault: false });
}

/** Change some fields of a profile; the rest stay. Open panels keep what they started with. */
export function updateAgentProfile(id: string, body: Record<string, unknown> = {}): AgentProfile {
  const { id: _id, createdAt: _c, updatedAt: _u, ...current } = getAgentProfile(id);
  agentProfiles.update(id, parseInput({ ...current, ...body }, id));
  const next = getAgentProfile(id);
  keepOneDefault(next);
  changed();
  return next;
}

/** Delete a profile. Open panels keep running; sessions it started resume without a profile. */
export function deleteAgentProfile(id: string): void {
  getAgentProfile(id);
  agentProfiles.remove(id);
  changed();
}

/** The running panels that started with this profile, in every project (panels keep a copy of it). */
export async function profileUses(id: string): Promise<ProfileUse[]> {
  getAgentProfile(id);
  const running = await runningPanels();
  return panels
    .all()
    .filter((p) => p.profile?.id === id && running.has(p.id))
    .map((p) => ({
      panelId: p.id,
      projectId: p.projectId,
      projectName: projects.get(p.projectId)?.name ?? "",
      kind: p.kind,
      title: p.title,
      ...(p.sessionId ? { sessionId: p.sessionId } : {}),
    }));
}

// ---- starting an agent with a profile ----

/**
 * The profile a panel of this kind starts with: the one asked for (it must be for that agent), else the one that
 * started this session (if it still exists), else the agent's default, else none. Shells have none.
 */
export function launchProfile(kind: PanelKind, profileId: string | undefined, sessionId?: string): AgentProfile | undefined {
  if (kind === "shell") {
    if (profileId) throw bad("Shells don't use agent profiles.");
    return undefined;
  }
  if (profileId) {
    const p = getAgentProfile(profileId);
    if (p.provider !== kind) throw bad(`${p.name} isn't a profile for this agent.`);
    return p;
  }
  const started = sessionId && agentProfiles.forSession(sessionId);
  const p = started ? agentProfiles.get(started) : undefined;
  if (p?.provider === kind) return checked(p);
  return listAgentProfiles().find((d) => d.provider === kind && d.isDefault);
}

const pluginDir = (panelId: string) => join(PANEL_PLUGINS_DIR, panelId);

function mcpConfig(servers: McpServer[]): string {
  const entries = servers.map(({ name, ...s }) => [name, s.type === "stdio" ? { type: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} } : { type: s.type, url: s.url, headers: s.headers ?? {} }]);
  return JSON.stringify({ mcpServers: Object.fromEntries(entries) });
}

/**
 * Claude Code flags for a profile, inserted after the bridge's. Its skills go in a plugin folder made for this
 * panel (`rails:<name>` in Claude Code). Skills that can't be found here (another project's) are left out.
 */
export async function profileFlags(profile: AgentProfile, panelId: string, projectPath: string): Promise<{ argv: string[]; missingSkills: SkillRef[] }> {
  const argv: string[] = [];
  if (profile.model) argv.push("--model", profile.model);
  if (profile.effort) argv.push("--effort", profile.effort);
  if (profile.permissionMode) argv.push("--permission-mode", profile.permissionMode);
  if (profile.instructions.trim()) argv.push("--append-system-prompt", profile.instructions);
  // Each pattern is its own argument (patterns can have spaces); the next flag ends the list.
  if (profile.allowedTools.length) argv.push("--allowedTools", ...profile.allowedTools);
  if (profile.disallowedTools.length) argv.push("--disallowedTools", ...profile.disallowedTools);
  if (profile.mcpServers.length || profile.mcpOnly) {
    // In a file only the user can read, not on the command line: its env and headers may hold secrets, and a
    // command line shows in `ps` and in tmux. The panel's folder goes when the panel closes.
    const file = join(pluginDir(panelId), "mcp.json");
    await mkdir(pluginDir(panelId), { recursive: true });
    await writeFile(file, mcpConfig(profile.mcpServers), { mode: 0o600 });
    argv.push("--mcp-config", file);
  }
  if (profile.mcpOnly) argv.push("--strict-mcp-config");

  const missingSkills: SkillRef[] = [];
  const found: [string, string][] = [];
  for (const ref of profile.skills) {
    const dir = await resolveSkill(ref, projectPath);
    if (!dir) missingSkills.push(ref);
    else if (!found.some(([name]) => name === ref.name)) found.push([ref.name, dir]);
  }
  if (found.length) {
    const root = pluginDir(panelId);
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    await mkdir(join(root, "skills"), { recursive: true });
    await writeFile(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "rails", description: `Skills from the agent profile ${profile.name}` }));
    for (const [name, dir] of found) await symlink(dir, join(root, "skills", name));
    argv.push("--plugin-dir", root);
  }
  return { argv, missingSkills };
}

/** Remove a panel's plugin folder (when the panel closes or fails to start). Missing is fine. */
export async function removePanelPlugin(panelId: string): Promise<void> {
  await rm(pluginDir(panelId), { recursive: true, force: true });
}
