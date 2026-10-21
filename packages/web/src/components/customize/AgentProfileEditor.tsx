import { useEffect, useRef, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconPencil as Pencil, IconX as X } from "@tabler/icons-react";
import {
  AGENT_PROFILE_DESCRIPTION_MAX,
  AGENT_PROFILE_INSTRUCTIONS_MAX,
  AGENT_PROFILE_NAME_MAX,
  EFFORTS,
  TOOL_PATTERN_MAX,
  sessionKey,
  type AgentProfile,
  type AgentProfileInput,
  type Effort,
  type McpServer,
  type PermissionMode,
  type ProfileUse,
  type SkillInfo,
  type SkillRef,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { providerLabel } from "../../util.ts";
import { socket } from "../../ws.ts";
import { Dropdown } from "../Dropdown.tsx";
import { MenuButton } from "../Menu.tsx";
import { ProviderIcon } from "../ProviderIcon.tsx";
import { Segmented } from "../Segmented.tsx";
import { Switch } from "../Switch.tsx";
import { useAutoGrow } from "../useAutoGrow.ts";
import { EFFORT_LABELS, PERMISSION_LABELS } from "./CustomizePage.tsx";
import { SkillPicker, sourceLabel } from "./SkillPicker.tsx";

const MODELS = [
  { value: "", label: "Default" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
  { value: "custom", label: "Another model…" },
];

const PERMISSION_HELP: Record<PermissionMode | "", string> = {
  "": "Claude Code's own setting.",
  manual: "Asks before edits and commands.",
  acceptEdits: "Edits files without asking; asks before other tools.",
  auto: "Claude Code decides what's safe to run without asking.",
  plan: "Plans first and asks before changing anything.",
  dontAsk: "Never asks: tools not under Always allow are refused.",
  bypassPermissions: "Runs every tool without asking, shell commands included.",
};

const skillKey = (r: SkillRef) => `${r.source}:${r.name}`;

/**
 * One agent profile (ADR 0020), in Settings-style groups. Everything saves as you go: a text field when it loses
 * focus (Enter for one-line fields; Escape puts it back), a choice at once, and "Saved" shows in the header for a
 * moment. Open panels keep the settings they started with.
 */
export function AgentProfileEditor({ profile }: { profile: AgentProfile }) {
  const { providers } = useStore();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const loadSkills = () =>
    api.skills().then(
      (list) => setSkills(list),
      (e: any) => setError(e.message),
    );
  useEffect(() => void loadSkills(), []);

  const save = async (patch: Partial<AgentProfileInput>): Promise<boolean> => {
    try {
      await api.updateAgentProfile(profile.id, patch);
      setError("");
      setSaved(Date.now());
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the agent profile ${profile.name}?\n\nOpen panels keep running. Sessions it started resume with the default profile, if there is one.`)) return;
    try {
      await api.deleteAgentProfile(profile.id);
      navigate(href.customize());
    } catch (e: any) {
      setError(e.message);
    }
  };

  const modelChoice = MODELS.some((m) => m.value === profile.model && m.value !== "custom") ? profile.model : "custom";
  const [customModel, setCustomModel] = useState(modelChoice === "custom");

  return (
    <div className="cz-editor">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.customize()} aria-label="Back to agent profiles">
          <ChevronLeft size={18} />
        </a>
        <span className="sp-new-icon cz-head-icon" aria-hidden>
          <ProviderIcon provider={profile.provider} />
        </span>
        <h2 className="truncate" title={profile.name}>{profile.name}</h2>
        <span className="grow" />
        <span className="muted small" role="status">{saved ? "Saved" : ""}</span>
        <StartMenu profile={profile} onError={setError} />
      </header>
      {error && (
        <p className="error cz-error" role="alert">
          {error}
        </p>
      )}
      <div className="cz-body">
        <div className="cz-form">
          <section className="set-group" aria-labelledby="cz-general">
            <h3 id="cz-general">General</h3>
            <TextRow id="cz-name" label="Name" help="Shows in the + menu and on new panels' tabs." value={profile.name} max={AGENT_PROFILE_NAME_MAX} onSave={(name) => save({ name })} required />
            <TextRow
              id="cz-description"
              label="Description"
              help="One line about what it's for."
              placeholder="e.g. Frontend work in this design system"
              value={profile.description}
              max={AGENT_PROFILE_DESCRIPTION_MAX}
              onSave={(description) => save({ description })}
            />
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-agent">Agent</label>
                <p id="cz-agent-help">Codex and pi profiles come later.</p>
              </div>
              <Dropdown
                id="cz-agent"
                value={profile.provider}
                describedBy="cz-agent-help"
                onChange={() => {}}
                options={(["claude", "codex", "pi"] as const).map((id) => ({
                  value: id,
                  label: id === "claude" ? providerLabel[id] + (providers.find((p) => p.id === id)?.installed === false ? " (not installed)" : "") : `${providerLabel[id]} (not yet)`,
                  icon: <ProviderIcon provider={id} />,
                  disabled: id !== "claude",
                }))}
              />
            </div>
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-default">Default for {providerLabel[profile.provider]}</label>
                <p id="cz-default-help">Used when you start {providerLabel[profile.provider]} without picking a profile, and when you open one of its sessions that started without one.</p>
              </div>
              <Switch id="cz-default" checked={profile.isDefault} aria-describedby="cz-default-help" onChange={(isDefault) => void save({ isDefault })} />
            </div>
            <InUse profile={profile} />
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-model">Model</label>
                <p id="cz-model-help">Default is the model Claude Code would pick.</p>
              </div>
              <Dropdown
                id="cz-model"
                value={customModel ? "custom" : modelChoice}
                options={MODELS}
                describedBy="cz-model-help"
                onChange={(v) => {
                  setCustomModel(v === "custom");
                  if (v !== "custom") void save({ model: v });
                }}
              />
            </div>
            {customModel && (
              <TextRow
                id="cz-model-id"
                label="Model name"
                help="An alias or a full model id."
                placeholder="e.g. claude-opus-5-5"
                value={modelChoice === "custom" ? profile.model : ""}
                max={100}
                mono
                onSave={(model) => save({ model })}
              />
            )}
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-effort">Effort</label>
                <p id="cz-effort-help">How hard it thinks before answering.</p>
              </div>
              <Dropdown
                id="cz-effort"
                value={profile.effort}
                describedBy="cz-effort-help"
                options={[{ value: "", label: "Default" }, ...EFFORTS.map((e) => ({ value: e, label: EFFORT_LABELS[e] }))]}
                onChange={(v) => void save({ effort: v as Effort | "" })}
              />
            </div>
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-permissions">Permission mode</label>
                <p id="cz-permissions-help" className={profile.permissionMode === "bypassPermissions" ? "cz-warn" : undefined}>
                  {PERMISSION_HELP[profile.permissionMode]}
                </p>
              </div>
              <Dropdown
                id="cz-permissions"
                value={profile.permissionMode}
                describedBy="cz-permissions-help"
                options={[{ value: "", label: "Default" }, ...Object.entries(PERMISSION_LABELS).map(([value, label]) => ({ value, label }))]}
                onChange={(v) => void save({ permissionMode: v as PermissionMode | "" })}
              />
            </div>
          </section>

          <section className="set-group" aria-labelledby="cz-instructions-title">
            <h3 id="cz-instructions-title">Instructions</h3>
            <InstructionsField profile={profile} onSave={(instructions) => save({ instructions })} />
          </section>

          <section className="set-group" aria-labelledby="cz-skills">
            <h3 id="cz-skills">Skills</h3>
            <p className="set-intro">
              {profile.skills.length ? "What this profile adds. Your own and the project's skills still load." : "None yet. Skills teach the agent one kind of work, like reviewing interfaces or writing docs."}
            </p>
            {profile.skills.length > 0 && (
              <ul className="cz-list">
                {profile.skills.map((ref) => (
                  <SkillRow key={skillKey(ref)} skillRef={ref} info={skills?.find((s) => skillKey(s.ref) === skillKey(ref))} loaded={!!skills} onRemove={() => void save({ skills: profile.skills.filter((r) => skillKey(r) !== skillKey(ref)) })} />
                ))}
              </ul>
            )}
            <div className="cz-actions">
              <button type="button" className="btn small" onClick={() => setPicking(true)}>
                {profile.skills.length ? "Choose skills" : "Add skills"}
              </button>
            </div>
            {picking && (
              <SkillPicker
                profileName={profile.name}
                chosen={profile.skills}
                skills={skills}
                onReload={loadSkills}
                onClose={() => setPicking(false)}
                onSave={(next) => save({ skills: next })}
              />
            )}
          </section>

          <section className="set-group" aria-labelledby="cz-tools">
            <h3 id="cz-tools">Tools</h3>
            <p className="set-intro">Tool names or patterns, like Read, WebFetch or Bash(npm test:*).</p>
            <PatternList id="cz-allow" label="Always allow" help="Runs without asking." values={profile.allowedTools} placeholder="e.g. Bash(npm test:*)" onSave={(allowedTools) => save({ allowedTools })} />
            <PatternList id="cz-deny" label="Never allow" help="Taken away from the agent." values={profile.disallowedTools} placeholder="e.g. WebFetch" onSave={(disallowedTools) => save({ disallowedTools })} />
          </section>

          <section className="set-group" aria-labelledby="cz-mcp">
            <h3 id="cz-mcp">MCP servers</h3>
            <McpServers servers={profile.mcpServers} onSave={(mcpServers) => save({ mcpServers })} />
            <div className="set-row">
              <div className="set-text">
                <label htmlFor="cz-mcp-only">Only these servers</label>
                <p id="cz-mcp-only-help">Leave out the MCP servers from your own and the project's settings.</p>
              </div>
              <Switch id="cz-mcp-only" checked={profile.mcpOnly} aria-describedby="cz-mcp-only-help" onChange={(mcpOnly) => void save({ mcpOnly })} />
            </div>
          </section>

          <section className="set-group cz-end" aria-label="Delete">
            <p className="set-intro">Open panels keep the settings they started with. Reopen them to pick up changes.</p>
            <div className="cz-actions">
              <button type="button" className="btn small danger" onClick={() => void remove()}>
                Delete {profile.name}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * "Start": open a panel with this profile in a project the user picks, then go there. Greyed out while the agent
 * isn't installed on the server.
 */
function StartMenu({ profile, onError }: { profile: AgentProfile; onError(message: string): void }) {
  const { projects, providers } = useStore();
  const agent = providerLabel[profile.provider];
  const installed = providers.find((p) => p.id === profile.provider)?.installed ?? false;
  const start = async (projectId: string) => {
    onError("");
    try {
      await api.openPanel(projectId, { kind: profile.provider, agentProfileId: profile.id });
      navigate(href.project(projectId));
    } catch (e: any) {
      onError(e.message);
    }
  };
  if (!installed) return <button className="btn small" disabled title={`${agent} isn't installed on the server`}>Start</button>;
  return (
    <MenuButton
      plain
      className="btn small"
      label={`Start ${agent} with ${profile.name}`}
      title="Start a panel with this profile"
      icon="Start"
      align="right"
      items={projects.length ? projects.map((p) => ({ label: p.name, onSelect: () => void start(p.id) })) : [{ label: "Add a project first", disabled: true, onSelect: () => {} }]}
    />
  );
}

/** Where the profile is in use: the running panels that started with it, each a link that opens it. */
function InUse({ profile }: { profile: AgentProfile }) {
  const [uses, setUses] = useState<ProfileUse[] | null>(null);
  useEffect(() => {
    const load = () => void api.profileUses(profile.id).then(setUses, () => {});
    load();
    return socket.on((m) => {
      if (m.type === "panels.changed") load(); // a panel opened or closed somewhere
    });
  }, [profile.id]);
  return (
    <div className="set-row">
      <div className="set-text">
        <span className="set-label">In use</span>
        {uses && !uses.length && <p>Not running in any panel. Start one above, or pick it from a pane's + menu.</p>}
        {uses && uses.length > 0 && (
          <ul className="cz-uses" aria-label="Panels using this profile">
            {uses.map((u) => (
              <li key={u.panelId}>
                <a href={u.sessionId ? href.session(u.projectId, sessionKey(profile.provider, u.sessionId)) : href.project(u.projectId)}>
                  <ProviderIcon provider={profile.provider} />
                  <span className="truncate">
                    {u.projectName} · {u.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A one-line setting saved when the field loses focus (or on Enter); Escape puts it back. */
export function TextRow(props: { id: string; label: string; help: string; value: string; max: number; placeholder?: string; mono?: boolean; required?: boolean; onSave(v: string): Promise<boolean> }) {
  const { id, label, help, value, max, placeholder, mono, required, onSave } = props;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = async () => {
    const next = text.trim();
    if (next === value) return setText(value);
    if (required && !next) return setText(value);
    if (!(await onSave(next))) setText(value);
  };
  return (
    <div className="set-row">
      <div className="set-text">
        <label htmlFor={id}>{label}</label>
        <p id={`${id}-help`}>{help}</p>
      </div>
      <input
        id={id}
        className={"input" + (mono ? " mono" : "")}
        maxLength={max}
        placeholder={placeholder}
        value={text}
        aria-describedby={`${id}-help`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(value);
        }}
      />
    </div>
  );
}

/** What the agent is told on top of its own system prompt. Saved when the field loses focus. */
function InstructionsField({ profile, onSave }: { profile: AgentProfile; onSave(text: string): Promise<boolean> }) {
  const [text, setText] = useState(profile.instructions);
  const [editing, setEditing] = useState(false);
  const reverting = useRef(false);
  const ref = useAutoGrow(text);
  useEffect(() => {
    if (!editing) setText(profile.instructions);
  }, [profile.instructions, editing]);
  const commit = async () => {
    setEditing(false);
    if (reverting.current) return void (reverting.current = false);
    if (text.trimEnd() !== profile.instructions && !(await onSave(text))) setText(profile.instructions);
  };
  const near = text.length > AGENT_PROFILE_INSTRUCTIONS_MAX * 0.8;
  return (
    <div className="settings-field cz-field">
      <label htmlFor="cz-instructions" className="sr-only">Instructions</label>
      <textarea
        ref={ref}
        id="cz-instructions"
        className="input cz-instructions"
        rows={4}
        maxLength={AGENT_PROFILE_INSTRUCTIONS_MAX}
        placeholder="e.g. You work on the frontend. Follow DESIGN.md, reuse the tokens in styles.css and check every screen in both themes."
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text !== profile.instructions) {
            reverting.current = true;
            setText(profile.instructions);
            e.currentTarget.blur();
          }
        }}
        aria-describedby="cz-instructions-help"
      />
      <p id="cz-instructions-help" className="muted small">
        Added to Claude Code's system prompt in new sessions; resumed ones keep what they started with.
        {near ? ` ${text.length.toLocaleString()} / ${AGENT_PROFILE_INSTRUCTIONS_MAX.toLocaleString()}` : ""}
      </p>
    </div>
  );
}

/** A skill the profile loads: its name and where it's from, what it does, and remove. */
function SkillRow({ skillRef, info, loaded, onRemove }: { skillRef: SkillRef; info?: SkillInfo; loaded: boolean; onRemove(): void }) {
  return (
    <li className="cz-item">
      <div className="cz-item-text">
        <p className="cz-item-top">
          <span className="cz-item-name truncate">{skillRef.name}</span>
          <span className="cz-source">{info ? sourceLabel(info) : sourceLabel({ ref: skillRef })}</span>
        </p>
        {info ? (
          <p className="cz-item-desc" title={info.description}>
            {info.manual ? `You run it with /rails:${skillRef.name}. ` : ""}
            {info.description}
          </p>
        ) : (
          loaded && <p className="cz-warn">Not found. It's left out when a panel starts.</p>
        )}
      </div>
      <button type="button" className="icon-btn sp-rule-remove" aria-label={`Remove the skill ${skillRef.name}`} title="Remove" onClick={onRemove}>
        <X size={14} />
      </button>
    </li>
  );
}

/** A short list of tool patterns, numbered, each editable in place, with a field to add one. */
function PatternList({ id, label, help, values, placeholder, onSave }: { id: string; label: string; help: string; values: string[]; placeholder: string; onSave(next: string[]): Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const add = async () => {
    const v = draft.trim();
    if (v && (await onSave([...values, v]))) setDraft("");
  };
  return (
    <div className="settings-field cz-field" role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}>
      <p id={`${id}-label`} className="set-label">{label}</p>
      <p id={`${id}-help`} className="muted small">{help}</p>
      {values.length > 0 && (
        <ol className="sp-rules-list">
          {values.map((v, i) => (
            <PatternRow
              key={`${i}:${v}`}
              n={i + 1}
              label={label}
              value={v}
              onSave={(next) => onSave(values.map((x, j) => (j === i ? next : x)).filter((x) => x.trim()))}
              onRemove={() => void onSave(values.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      <form
        className="sp-rule-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input mono" aria-label={`Add to ${label}`} maxLength={TOOL_PATTERN_MAX} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setDraft("")} />
        {draft.trim() && (
          <div className="sp-field-foot">
            <span className="grow" />
            <button type="button" className="btn small" onClick={() => setDraft("")}>Cancel</button>
            <button className="btn small primary">Add</button>
          </div>
        )}
      </form>
    </div>
  );
}

function PatternRow({ n, label, value, onSave, onRemove }: { n: number; label: string; value: string; onSave(next: string): Promise<boolean>; onRemove(): void }) {
  const [text, setText] = useState(value);
  const commit = () => {
    if (text.trim() === value) return setText(value);
    void onSave(text).then((ok) => ok || setText(value));
  };
  return (
    <li className="sp-rule">
      <span className="sp-rule-n" aria-hidden>{n}</span>
      <input
        className="sp-rule-text mono"
        aria-label={`${label} ${n}`}
        maxLength={TOOL_PATTERN_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(value);
        }}
      />
      <button type="button" className="icon-btn sp-rule-remove" aria-label={`Remove ${text || value} from ${label}`} title="Remove" onClick={onRemove}>
        <X size={14} />
      </button>
    </li>
  );
}

// ---- MCP servers ----

const TYPE_LABELS = { stdio: "Command", http: "HTTP", sse: "SSE" } as const;

/** The profile's MCP servers as rows, each editable in a small form in its place, and a button to add one. */
function McpServers({ servers, onSave }: { servers: McpServer[]; onSave(next: McpServer[]): Promise<boolean> }) {
  /** The index being edited, "new" for a new one, or null. */
  const [editing, setEditing] = useState<number | "new" | null>(null);
  return (
    <>
      <p className="set-intro">
        {servers.length ? "What this profile adds." : "None yet."} Values are stored in Rails, so write secrets as {"${VAR}"}: Claude Code reads them from the environment.
      </p>
      {servers.length > 0 && (
        <ul className="cz-list">
          {servers.map((s, i) =>
            editing === i ? (
              <li key={s.name}>
                <McpForm initial={s} onCancel={() => setEditing(null)} onSave={async (next) => (await onSave(servers.map((x, j) => (j === i ? next : x)))) && (setEditing(null), true)} />
              </li>
            ) : (
              <li key={s.name} className="cz-item">
                <div className="cz-item-text">
                  <p className="cz-item-top">
                    <span className="cz-item-name truncate">{s.name}</span>
                    <span className="cz-source">{TYPE_LABELS[s.type]}</span>
                  </p>
                  <p className="cz-item-mono">{s.type === "stdio" ? [s.command, ...(s.args ?? [])].join(" ") : s.url}</p>
                </div>
                <button type="button" className="icon-btn sp-rule-remove" aria-label={`Edit the MCP server ${s.name}`} title="Edit" onClick={() => setEditing(i)}>
                  <Pencil size={14} />
                </button>
                <button type="button" className="icon-btn sp-rule-remove" aria-label={`Remove the MCP server ${s.name}`} title="Remove" onClick={() => void onSave(servers.filter((_, j) => j !== i))}>
                  <X size={14} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" ? (
        <div className="cz-list">
          <McpForm onCancel={() => setEditing(null)} onSave={async (next) => (await onSave([...servers, next])) && (setEditing(null), true)} />
        </div>
      ) : (
        <div className="cz-actions">
          <button type="button" className="btn small" onClick={() => setEditing("new")}>Add server</button>
        </div>
      )}
    </>
  );
}

/** "KEY=value" (or "Name: value") lines to an object, and back. */
const parsePairs = (text: string, sep: "=" | ":") =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(sep);
        return i < 0 ? [l, ""] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
const showPairs = (o: Record<string, string> | undefined, sep: "=" | ": ") => Object.entries(o ?? {}).map(([k, v]) => `${k}${sep}${v}`).join("\n");

function McpForm({ initial, onSave, onCancel }: { initial?: McpServer; onSave(s: McpServer): Promise<boolean>; onCancel(): void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<McpServer["type"]>(initial?.type ?? "stdio");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [args, setArgs] = useState((initial?.args ?? []).join("\n"));
  const [env, setEnv] = useState(showPairs(initial?.env, "="));
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState(showPairs(initial?.headers, ": "));
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const argsRef = useAutoGrow(args);
  const envRef = useAutoGrow(env);
  const headersRef = useAutoGrow(headers);
  const id = initial ? `cz-mcp-${initial.name}` : "cz-mcp-new";

  const submit = async () => {
    setBusy(true);
    const server: McpServer =
      type === "stdio"
        ? { name: name.trim(), type, command: command.trim(), args: args.split("\n").map((a) => a.trim()).filter(Boolean), env: parsePairs(env, "=") }
        : { name: name.trim(), type, url: url.trim(), headers: parsePairs(headers, ":") };
    await onSave(server); // errors show at the top of the editor
    setBusy(false);
  };

  return (
    <form
      className="cz-mcp-form"
      aria-label={initial ? `Edit ${initial.name}` : "New MCP server"}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div className="settings-field">
        <label htmlFor={`${id}-name`}>Name</label>
        <input ref={first} id={`${id}-name`} className="input" maxLength={40} placeholder="e.g. github" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="settings-field">
        <span id={`${id}-type`} className="cz-field-label">Type</span>
        <Segmented<McpServer["type"]>
          name={`${id}-type`}
          aria-labelledby={`${id}-type`}
          value={type}
          onChange={setType}
          options={(["stdio", "http", "sse"] as const).map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
        />
      </div>
      {type === "stdio" ? (
        <>
          <div className="settings-field">
            <label htmlFor={`${id}-command`}>Command</label>
            <input id={`${id}-command`} className="input mono" placeholder="e.g. npx" value={command} onChange={(e) => setCommand(e.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor={`${id}-args`}>Arguments</label>
            <textarea ref={argsRef} id={`${id}-args`} className="input mono" rows={1} placeholder="One per line, e.g. -y" value={args} onChange={(e) => setArgs(e.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor={`${id}-env`}>Environment</label>
            <textarea ref={envRef} id={`${id}-env`} className="input mono" rows={1} placeholder="One per line, e.g. GITHUB_TOKEN=${GITHUB_TOKEN}" value={env} onChange={(e) => setEnv(e.target.value)} />
          </div>
        </>
      ) : (
        <>
          <div className="settings-field">
            <label htmlFor={`${id}-url`}>URL</label>
            <input id={`${id}-url`} className="input mono" type="url" placeholder="e.g. https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="settings-field">
            <label htmlFor={`${id}-headers`}>Headers</label>
            <textarea ref={headersRef} id={`${id}-headers`} className="input mono" rows={1} placeholder="One per line, e.g. Authorization: Bearer ${API_TOKEN}" value={headers} onChange={(e) => setHeaders(e.target.value)} />
          </div>
        </>
      )}
      <div className="sp-field-foot">
        <span className="grow" />
        <button type="button" className="btn small" onClick={onCancel}>Cancel</button>
        <button className="btn small primary" disabled={busy}>{initial ? "Save server" : "Add server"}</button>
      </div>
    </form>
  );
}
