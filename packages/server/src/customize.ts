// Customize (ADR 0020): agent profiles (named launch options for an agent, applied as command-line flags
// when Rails starts it in a panel) and saved prompts. Only flags: Rails never writes an agent's own
// settings files. Profiles exist for the agents in PROFILE_AGENTS, whose flags were checked on a real install.
import {
  CLAUDE_EFFORTS,
  CLAUDE_PERMISSION_MODES,
  PROFILE_AGENTS,
  PROFILE_INSTRUCTIONS_MAX,
  PROFILE_NAME_MAX_LEN,
  PROFILE_TOOL_MAX,
  PROFILE_TOOLS_MAX,
  SAVED_PROMPT_NAME_MAX,
  SAVED_PROMPT_TEXT_MAX,
  type AgentProfile,
  type AgentProfileInput,
  type PanelKind,
  type ProfileUse,
  type SavedPrompt,
  type SavedPromptInput,
} from "@rails/shared";
import { agentProfiles, panels, projects, savedPrompts, type StoredProfile } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { runningPanels } from "./tmux.ts";
import { listeners } from "./util.ts";

// ---- change notifications (the terminal hub forwards these to every browser) ----
const changes = listeners();
export const onCustomizeChanged = changes.on;
const changed = changes.emit;

type Options = Pick<AgentProfile, "model" | "effort" | "permissionMode" | "instructions" | "allowedTools" | "disallowedTools">;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** A model name or alias: no spaces, and never something that reads as another flag. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,99}$/;

/** Stored options, with anything no longer valid replaced by the agent's default instead of breaking a launch. */
function repairOptions(raw: unknown): Options {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tools = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && toolOk(t)) : []);
  return {
    model: typeof o.model === "string" && MODEL.test(o.model) ? o.model : "",
    effort: isOneOf(CLAUDE_EFFORTS, o.effort) ? o.effort : "",
    permissionMode: isOneOf(CLAUDE_PERMISSION_MODES, o.permissionMode) ? o.permissionMode : "",
    instructions: typeof o.instructions === "string" ? o.instructions.slice(0, PROFILE_INSTRUCTIONS_MAX) : "",
    allowedTools: tools(o.allowedTools),
    disallowedTools: tools(o.disallowedTools),
  };
}

// A tool pattern is one argument after --allowed-tools: it mustn't look like a flag or hold control characters.
const toolOk = (t: string) => t.length > 0 && t.length <= PROFILE_TOOL_MAX && !t.startsWith("-") && !/[\x00-\x1f]/.test(t);

function parseTools(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== "string")) throw new ServiceError(`${label} must be a list of tool names`, 400);
  const list = (raw as string[]).map((t) => t.trim()).filter(Boolean);
  if (list.length > PROFILE_TOOLS_MAX) throw new ServiceError(`${label}: at most ${PROFILE_TOOLS_MAX} tools.`, 400);
  const bad = list.find((t) => !toolOk(t));
  if (bad) throw new ServiceError(`${label}: "${bad.slice(0, 40)}" isn't a tool name (at most ${PROFILE_TOOL_MAX} characters, not starting with "-").`, 400);
  return list;
}

/** The options a request changes, every one checked before any is applied. */
function parseOptions(body: AgentProfileInput, current: Options): Options {
  const next = { ...current };
  if (body.model !== undefined) {
    const model = typeof body.model === "string" ? body.model.trim() : null;
    if (model === null || (model && !MODEL.test(model))) throw new ServiceError("That doesn't look like a model name (e.g. opus, sonnet, or a full model id).", 400);
    next.model = model;
  }
  if (body.effort !== undefined) {
    if (body.effort !== "" && !isOneOf(CLAUDE_EFFORTS, body.effort)) throw new ServiceError("Unknown effort level", 400);
    next.effort = body.effort;
  }
  if (body.permissionMode !== undefined) {
    if (body.permissionMode !== "" && !isOneOf(CLAUDE_PERMISSION_MODES, body.permissionMode)) throw new ServiceError("Unknown permission mode", 400);
    next.permissionMode = body.permissionMode;
  }
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string") throw new ServiceError("Instructions must be text", 400);
    const text = body.instructions.trim();
    if (text.length > PROFILE_INSTRUCTIONS_MAX) throw new ServiceError(`Instructions can be at most ${PROFILE_INSTRUCTIONS_MAX} characters.`, 400);
    next.instructions = text;
  }
  if (body.allowedTools !== undefined) next.allowedTools = parseTools(body.allowedTools, "Allowed tools");
  if (body.disallowedTools !== undefined) next.disallowedTools = parseTools(body.disallowedTools, "Denied tools");
  return next;
}

const shown = ({ options, ...p }: StoredProfile): AgentProfile => ({ ...p, ...repairOptions(options) });

function getProfile(id: string): AgentProfile {
  const p = agentProfiles.get(id);
  if (!p) throw new ServiceError("Not found", 404);
  return shown(p);
}

/** A name from a request, or (none given) the first free "New profile", "New profile 2"… */
function profileName(raw: unknown, agent: string, exceptId?: string): string {
  const taken = new Set(agentProfiles.list().filter((p) => p.agent === agent && p.id !== exceptId).map((p) => p.name.toLowerCase()));
  if (raw === undefined) {
    for (let n = 1; ; n++) {
      const name = n === 1 ? "New profile" : `New profile ${n}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > PROFILE_NAME_MAX_LEN) throw new ServiceError(`Names can be at most ${PROFILE_NAME_MAX_LEN} characters.`, 400);
  if (taken.has(name.toLowerCase())) throw new ServiceError(`There's already a profile called ${name}.`, 409);
  return name;
}

export function listProfiles(): AgentProfile[] {
  return agentProfiles.list().map(shown);
}

export function createProfile(body: AgentProfileInput | undefined): AgentProfile {
  const b = body ?? {};
  if (!isOneOf(PROFILE_AGENTS, b.agent)) throw new ServiceError("Profiles are available for Claude Code so far.", 400);
  if (b.isDefault !== undefined && typeof b.isDefault !== "boolean") throw new ServiceError("isDefault must be true or false", 400);
  const name = profileName(b.name, b.agent);
  const options = parseOptions(b, repairOptions({}));
  const created = agentProfiles.create(name, b.agent, options);
  if (b.isDefault) agentProfiles.setDefault(created.id, true);
  changed();
  return getProfile(created.id);
}

/** Change a profile. Its agent stays: a profile's options are that agent's flags. */
export function updateProfile(id: string, body: AgentProfileInput | undefined): AgentProfile {
  const current = getProfile(id);
  const b = body ?? {};
  if (b.agent !== undefined && b.agent !== current.agent) throw new ServiceError("A profile's agent can't change. Make a new profile instead.", 400);
  if (b.isDefault !== undefined && typeof b.isDefault !== "boolean") throw new ServiceError("isDefault must be true or false", 400);
  const name = b.name === undefined ? current.name : profileName(b.name, current.agent, id);
  const options = parseOptions(b, current);
  agentProfiles.update(id, name, options);
  if (b.isDefault !== undefined) agentProfiles.setDefault(id, b.isDefault);
  changed();
  return getProfile(id);
}

export function deleteProfile(id: string): void {
  getProfile(id);
  agentProfiles.remove(id);
  changed();
}

/**
 * The profile a panel of this kind starts with: the one asked for (it must be for that agent), else the agent's
 * default, else none. Shells have none.
 */
export function launchProfile(kind: PanelKind, profileId: string | undefined): AgentProfile | undefined {
  if (kind === "shell") {
    if (profileId) throw new ServiceError("Shells don't use profiles", 400);
    return undefined;
  }
  if (profileId) {
    const p = agentProfiles.get(profileId);
    if (!p || p.agent !== kind) throw new ServiceError("Unknown profile for this agent", 400);
    return shown(p);
  }
  const d = agentProfiles.defaultFor(kind);
  return d && shown(d);
}

/** The running panels that started with this profile, in every project (panels keep a snapshot of it). */
export async function profileUses(id: string): Promise<ProfileUse[]> {
  getProfile(id);
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

// ---- saved prompts ----

function parsePrompt(body: SavedPromptInput | undefined, current?: SavedPrompt): { name: string; text: string } {
  const b = body ?? {};
  const name = b.name === undefined ? (current?.name ?? "New prompt") : typeof b.name === "string" ? b.name.trim() : "";
  const text = b.text === undefined ? (current?.text ?? "") : typeof b.text === "string" ? b.text.trim() : null;
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > SAVED_PROMPT_NAME_MAX) throw new ServiceError(`Names can be at most ${SAVED_PROMPT_NAME_MAX} characters.`, 400);
  if (text === null) throw new ServiceError("The prompt must be text", 400);
  if (text.length > SAVED_PROMPT_TEXT_MAX) throw new ServiceError(`Prompts can be at most ${SAVED_PROMPT_TEXT_MAX} characters.`, 400);
  return { name, text };
}

function getPrompt(id: string): SavedPrompt {
  const p = savedPrompts.get(id);
  if (!p) throw new ServiceError("Not found", 404);
  return p;
}

export const listPrompts = (): SavedPrompt[] => savedPrompts.list();

export function createPrompt(body: SavedPromptInput | undefined): SavedPrompt {
  const { name, text } = parsePrompt(body);
  const created = savedPrompts.create(name, text);
  changed();
  return created;
}

export function updatePrompt(id: string, body: SavedPromptInput | undefined): SavedPrompt {
  const { name, text } = parsePrompt(body, getPrompt(id));
  savedPrompts.update(id, name, text);
  changed();
  return getPrompt(id);
}

export function deletePrompt(id: string): void {
  getPrompt(id);
  savedPrompts.remove(id);
  changed();
}
