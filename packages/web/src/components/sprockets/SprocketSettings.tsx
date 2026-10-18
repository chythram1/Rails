import { useEffect, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconLayoutSidebarRightCollapse as Collapse } from "@tabler/icons-react";
import { SPROCKET_DESCRIPTION_MAX, type Sprocket as SprocketData, type SprocketSettings as Settings } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { Dropdown } from "../Dropdown.tsx";
import { ModelSelect, useModelSettings } from "../ModelSelect.tsx";
import { useOpenSettings } from "../settings/context.ts";
import { Switch } from "../Switch.tsx";
import { Sprocket } from "./Sprocket.tsx";

/**
 * A Sprocket's settings, in a panel beside its chat (ref/sprockets/stage2/chat2.png): its look and name,
 * its description, the project it's attached to, whether it's that project's Coordinator, and its model.
 * Its core memory is its own business and isn't shown. Moving it to another project deletes its
 * chat there, so that asks first; its name, look and core memory stay. The panel has its own URL
 * (`#/sprockets/<id>/settings`), so the browser's back button closes it.
 */
export function SprocketSettings({ sprocket, all }: { sprocket: SprocketData; all: SprocketData[] }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const project = projects.find((p) => p.id === sprocket.projectId);
  const coordinator = all.find((s) => s.projectId && s.projectId === sprocket.projectId && s.coordinator && s.id !== id);
  const { settings: models } = useModelSettings();
  const openSettings = useOpenSettings();
  const [error, setError] = useState("");
  const close = () => navigate(href.sprocket(id));

  const save = async (body: Settings) => {
    setError("");
    try {
      await api.sprocketSettings(id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const move = async (projectId: string) => {
    const to = projects.find((p) => p.id === projectId);
    const question = to ? `Attach ${name} to ${to.name}?` : `Detach ${name} from its project?`;
    if (sprocket.lastMessage && !confirm(`${question}\n\nIts chat is deleted. Its name, look and core memory stay.`)) return;
    await save({ projectId: projectId || null });
  };

  const setCoordinator = async (on: boolean) => {
    if (on && coordinator && project && !confirm(`Make ${name} the Coordinator of ${project.name}?\n\n${coordinator.name} stops being it.`)) return;
    await save({ coordinator: on });
  };

  const defaultName = models?.models.find((m) => m.ref === models.defaultModel)?.name;

  return (
    <aside className="sp-panel" aria-labelledby="sp-panel-title" onKeyDown={(e) => e.key === "Escape" && close()}>
      <header className="sp-panel-head">
        <button className="icon-btn sp-panel-back" aria-label={`Back to the chat with ${name}`} onClick={close}>
          <ChevronLeft size={18} />
        </button>
        <h2 id="sp-panel-title">Settings</h2>
        <button className="icon-btn sp-panel-collapse" aria-label="Close settings" title="Close settings" onClick={close}>
          <Collapse size={18} />
        </button>
      </header>
      <div className="sp-panel-body">
        <div className="sp-panel-look">
          <Sprocket look={sprocket.look} size={72} seed={id} />
          <a className="btn small" href={href.editSprocket(id)}>Change look</a>
        </div>

        <NameField sprocket={sprocket} onError={setError} />
        <DescriptionField sprocket={sprocket} onSave={(description) => save({ description })} />

        <div className="settings-field">
          <label htmlFor="sp-project">Project</label>
          <Dropdown
            id="sp-project"
            value={sprocket.projectId ?? ""}
            disabled={sprocket.running}
            options={[{ value: "", label: "None" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(v) => void move(v)}
          />
          <p className="muted small">
            {sprocket.running ? `${name} is replying. You can move it when it's done.` : "A Sprocket helps with one project at a time. Moving it starts a new chat."}
          </p>
        </div>

        <div className="settings-field sp-switch-field">
          <div className="sp-switch-text">
            <label htmlFor="sp-coordinator">Coordinator</label>
            <p id="sp-coordinator-help" className="muted small">
              {!project
                ? `Attach ${name} to a project first.`
                : `When a session in ${project.name} waits for you, ${name} tells you what it needs. One Sprocket per project${coordinator ? `; now it's ${coordinator.name}` : ""}.`}
            </p>
          </div>
          <Switch
            id="sp-coordinator"
            checked={sprocket.coordinator}
            disabled={!project}
            aria-describedby="sp-coordinator-help"
            onChange={(on) => void setCoordinator(on)}
          />
        </div>

        <div className="settings-field">
          <label htmlFor="sp-model">Model</label>
          {models && (
            <ModelSelect
              id="sp-model"
              settings={models}
              value={sprocket.model}
              empty={defaultName ? `Default (${defaultName})` : "Default (none set)"}
              onChange={(ref) => void save({ model: ref })}
            />
          )}
          <p className="muted small">
            {models && !models.models.length ? "No providers are set up yet. " : ""}
            <button type="button" className="link" onClick={() => openSettings("models")}>
              Set up providers in Settings
            </button>
          </p>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}

/** The name, saved when the field loses focus (or on Enter). The look is changed in the creator. */
function NameField({ sprocket, onError }: { sprocket: SprocketData; onError(message: string): void }) {
  const [value, setValue] = useState(sprocket.name);
  useEffect(() => setValue(sprocket.name), [sprocket.name]);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === sprocket.name) return setValue(sprocket.name);
    try {
      await api.updateSprocket(sprocket.id, { name: next, look: sprocket.look });
      onError("");
    } catch (e: any) {
      onError(e.message);
      setValue(sprocket.name);
    }
  };
  return (
    <div className="settings-field">
      <label htmlFor="sp-name">Name</label>
      <input
        id="sp-name"
        className="input"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}

/**
 * The description: what the user wants from this Sprocket, in a few sentences. It's its standing
 * instructions, a small AGENTS.md that goes into every run, and it stays with it across projects.
 */
function DescriptionField({ sprocket, onSave }: { sprocket: SprocketData; onSave(text: string): Promise<boolean> }) {
  const [text, setText] = useState(sprocket.description);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(sprocket.description), [sprocket.description]);
  const dirty = text.trim() !== sprocket.description;
  return (
    <form
      className="settings-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(text)) setSaved(true);
      }}
    >
      <label htmlFor="sp-description">Description</label>
      <p id="sp-description-help" className="muted small">{sprocket.name} follows this in every reply, in any project.</p>
      <textarea
        id="sp-description"
        className="input"
        rows={4}
        maxLength={SPROCKET_DESCRIPTION_MAX}
        placeholder="What it's for and how it should work, e.g. “Keep an eye on the PRs in this project and tell me what looks risky.”"
        value={text}
        onChange={(e) => (setText(e.target.value), setSaved(false))}
        aria-describedby="sp-description-help"
      />
      <div className="sp-field-foot">
        <span className="muted small">{text.length} / {SPROCKET_DESCRIPTION_MAX}</span>
        <span className="grow" />
        {saved && !dirty && <span className="muted small" role="status">Saved</span>}
        {dirty && <button type="button" className="btn small" onClick={() => setText(sprocket.description)}>Undo</button>}
        <button className="btn small primary" disabled={!dirty}>Save</button>
      </div>
    </form>
  );
}
