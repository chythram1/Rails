import { useEffect, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconDots as Dots } from "@tabler/icons-react";
import {
  CLAUDE_EFFORTS,
  CLAUDE_PERMISSION_MODES,
  PROFILE_INSTRUCTIONS_MAX,
  PROFILE_NAME_MAX_LEN,
  PROFILE_TOOLS_MAX,
  type AgentProfile,
  type AgentProfileInput,
  type ProfileUse,
  sessionKey,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { providerLabel } from "../../util.ts";
import { socket } from "../../ws.ts";
import { Dropdown } from "../Dropdown.tsx";
import { MenuButton } from "../Menu.tsx";
import { ProviderIcon } from "../ProviderIcon.tsx";
import { Switch } from "../Switch.tsx";

const PERMISSION_LABELS: Record<(typeof CLAUDE_PERMISSION_MODES)[number], string> = {
  manual: "Manual",
  acceptEdits: "Accept edits",
  auto: "Auto",
  plan: "Plan",
  dontAsk: "Don't ask",
  bypassPermissions: "Bypass permissions",
};
const EFFORT_LABELS: Record<(typeof CLAUDE_EFFORTS)[number], string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };

/** One line about a profile for lists and menus: what it changes ("opus · Plan · 2 tools allowed"). */
export function profileSummary(p: AgentProfile): string {
  const parts = [
    p.model,
    p.effort && `${EFFORT_LABELS[p.effort]} effort`,
    p.permissionMode && PERMISSION_LABELS[p.permissionMode],
    p.instructions && "Instructions",
    p.allowedTools.length && `${p.allowedTools.length} allowed`,
    p.disallowedTools.length && `${p.disallowedTools.length} denied`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : `${providerLabel[p.agent]}'s own settings`;
}

/**
 * One agent profile (ADR 0020), in the rows of a Settings section: its name and whether it's the default,
 * then the launch options, each the flag Rails passes to the agent. Choices save at once; text saves when
 * its field loses focus (one-line fields) or with Save (long ones).
 */
export function ProfileEditor({ profile }: { profile: AgentProfile }) {
  const { id, name } = profile;
  const agent = providerLabel[profile.agent];
  const [error, setError] = useState("");

  const save = async (body: AgentProfileInput) => {
    setError("");
    try {
      await api.updateAgentProfile(id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the profile ${name}?\n\nRunning panels keep the options they started with.`)) return;
    try {
      await api.deleteAgentProfile(id);
      navigate(href.customize());
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="cz-editor">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.customize()} aria-label="All profiles and prompts">
          <ChevronLeft size={18} />
        </a>
        <ProviderIcon provider={profile.agent} />
        <h2 className="truncate" title={name}>{name}</h2>
        <span className="grow" />
        <StartMenu profile={profile} onError={setError} />
        <MenuButton label={`${name} actions`} title="More" icon={<Dots size={18} />} align="right" items={[{ label: "Delete profile", danger: true, onSelect: () => void remove() }]} />
      </header>
      <div className="cz-body">
        <section className="set-group" aria-labelledby="cz-profile-title">
          <h3 id="cz-profile-title">Profile</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-name">Name</label>
              <p>Shown in the + menu and on Home.</p>
            </div>
            <TextInput id="cz-name" value={name} maxLength={PROFILE_NAME_MAX_LEN} onSave={(v) => save({ name: v })} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label">Agent</span>
              <p>A profile's options are this agent's own flags.</p>
            </div>
            <span className="cz-agent">
              <ProviderIcon provider={profile.agent} /> {agent}
            </span>
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-default">Default for {agent}</label>
              <p id="cz-default-help">Used when you start {agent} without picking a profile, and when you open one of its sessions from the sidebar.</p>
            </div>
            <Switch id="cz-default" checked={profile.isDefault} aria-describedby="cz-default-help" onChange={(on) => void save({ isDefault: on })} />
          </div>
          <InUse profile={profile} />
        </section>

        <section className="set-group" aria-labelledby="cz-launch-title">
          <h3 id="cz-launch-title">Launch options</h3>
          <p className="set-intro">Rails starts {agent} with these in new panels. Empty ones keep {agent}'s own setting.</p>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-model">Model</label>
              <p>An alias like opus or sonnet, or a full model name.</p>
            </div>
            <TextInput id="cz-model" value={profile.model} maxLength={100} placeholder={`${agent}'s default`} onSave={(v) => save({ model: v })} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-effort">Effort</label>
              <p>How hard it thinks before answering.</p>
            </div>
            <Dropdown
              id="cz-effort"
              value={profile.effort}
              options={[{ value: "", label: "Default" }, ...CLAUDE_EFFORTS.map((e) => ({ value: e, label: EFFORT_LABELS[e] }))]}
              onChange={(v) => void save({ effort: v as AgentProfile["effort"] })}
            />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-permission">Permission mode</label>
              <p>
                {profile.permissionMode === "bypassPermissions"
                  ? `${agent} won't ask before running commands or changing files. Use it only for folders you can afford to lose.`
                  : "What it may do without asking you first."}
              </p>
            </div>
            <Dropdown
              id="cz-permission"
              value={profile.permissionMode}
              options={[{ value: "", label: "Default" }, ...CLAUDE_PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] }))]}
              onChange={(v) => void save({ permissionMode: v as AgentProfile["permissionMode"] })}
            />
          </div>
        </section>

        <section className="set-group" aria-labelledby="cz-instructions-title">
          <h3 id="cz-instructions-title">Instructions</h3>
          <LongText
            id="cz-instructions"
            label="Instructions"
            hideLabel
            help={`Added to ${agent}'s own system prompt in every session this profile starts.`}
            value={profile.instructions}
            maxLength={PROFILE_INSTRUCTIONS_MAX}
            placeholder="e.g. “Use pnpm, not npm. Run the tests before you say you're done.”"
            onSave={(v) => save({ instructions: v })}
          />
        </section>

        <section className="set-group" aria-labelledby="cz-tools-title">
          <h3 id="cz-tools-title">Tools</h3>
          <p className="set-intro">One tool per line, as {agent} writes them: a name like Edit, or a pattern like Bash(git *). At most {PROFILE_TOOLS_MAX} each.</p>
          <div className="cz-fields">
            <LongText
              id="cz-allowed"
              label="Allowed without asking"
              value={profile.allowedTools.join("\n")}
              placeholder={"Bash(git *)\nEdit"}
              onSave={(v) => save({ allowedTools: lines(v) })}
            />
            <LongText
              id="cz-denied"
              label="Never allowed"
              value={profile.disallowedTools.join("\n")}
              placeholder="WebFetch"
              onSave={(v) => save({ disallowedTools: lines(v) })}
            />
          </div>
        </section>

        {error && <p className="error" role="alert">{error}</p>}
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
  const installed = providers.find((p) => p.id === profile.agent)?.installed ?? false;
  const start = async (projectId: string) => {
    onError("");
    try {
      await api.openPanel(projectId, { kind: profile.agent, profileId: profile.id });
      navigate(href.project(projectId));
    } catch (e: any) {
      onError(e.message);
    }
  };
  if (!installed) return <button className="btn small" disabled title={`${providerLabel[profile.agent]} isn't installed on the server`}>Start</button>;
  return (
    <MenuButton
      plain
      className="btn small"
      label={`Start ${providerLabel[profile.agent]} with ${profile.name}`}
      title="Start a panel with this profile"
      icon="Start"
      align="right"
      items={
        projects.length
          ? projects.map((p) => ({ label: p.name, onSelect: () => void start(p.id) }))
          : [{ label: "Add a project first", disabled: true, onSelect: () => {} }]
      }
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
                <a href={u.sessionId ? href.session(u.projectId, sessionKey(profile.agent, u.sessionId)) : href.project(u.projectId)}>
                  <ProviderIcon provider={profile.agent} />
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

const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** A one-line field saved when it loses focus (or on Enter); Escape puts it back. A refused value goes back too. */
export function TextInput(props: { id: string; value: string; maxLength: number; placeholder?: string; onSave(value: string): Promise<boolean> }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  const commit = async () => {
    if (value.trim() === props.value) return setValue(props.value);
    if (!(await props.onSave(value.trim()))) setValue(props.value);
  };
  return (
    <input
      id={props.id}
      className="input"
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setValue(props.value);
      }}
    />
  );
}

/** A long text with Save and Undo under it (like a Sprocket's description), and its length when it has a limit. */
export function LongText(props: {
  id: string;
  label: string;
  /** The section's heading already names it: keep the label for screen readers only. */
  hideLabel?: boolean;
  help?: string;
  value: string;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  onSave(value: string): Promise<boolean>;
}) {
  const [text, setText] = useState(props.value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(props.value), [props.value]);
  const dirty = text.trim() !== props.value;
  return (
    <form
      className="settings-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await props.onSave(text)) setSaved(true);
      }}
    >
      <label htmlFor={props.id} className={props.hideLabel ? "sr-only" : undefined}>{props.label}</label>
      {props.help && <p id={`${props.id}-help`} className="muted small">{props.help}</p>}
      <textarea
        id={props.id}
        className="input"
        rows={props.rows ?? 4}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => (setText(e.target.value), setSaved(false))}
        aria-describedby={props.help ? `${props.id}-help` : undefined}
      />
      <div className="sp-field-foot">
        {props.maxLength && <span className="muted small">{text.length} / {props.maxLength}</span>}
        <span className="grow" />
        {saved && !dirty && <span className="muted small" role="status">Saved</span>}
        {dirty && <button type="button" className="btn small" onClick={() => setText(props.value)}>Undo</button>}
        <button className="btn small primary" disabled={!dirty}>Save</button>
      </div>
    </form>
  );
}
