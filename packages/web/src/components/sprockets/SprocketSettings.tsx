import { useEffect, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconLayoutSidebarRightCollapse as Collapse } from "@tabler/icons-react";
import { CORE_MEMORY_MAX, type Sprocket as SprocketData, type SprocketSettings as Settings } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ModelSelect, useModelSettings } from "../ModelSelect.tsx";
import { useOpenSettings } from "../settings/context.ts";
import { Sprocket } from "./Sprocket.tsx";

/**
 * A Sprocket's settings, in a panel beside its chat (ref/sprockets/stage2/chat2.png): its look and name,
 * the project it's attached to, its model and its core memory. Moving it to another project deletes its
 * chat there, so that asks first; its name, look and core memory stay. The panel has its own URL
 * (`#/sprockets/<id>/settings`), so the browser's back button closes it.
 */
export function SprocketSettings({ sprocket }: { sprocket: SprocketData }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
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

        <div className="settings-field">
          <label htmlFor="sp-project">Project</label>
          <select id="sp-project" className="input" value={sprocket.projectId ?? ""} disabled={sprocket.running} onChange={(e) => void move(e.target.value)}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="muted small">
            {sprocket.running ? `${name} is replying. You can move it when it's done.` : "A Sprocket helps with one project at a time. Moving it starts a new chat."}
          </p>
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

        <MemoryField sprocket={sprocket} onSave={(coreMemory) => save({ coreMemory })} />
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

/** Core memory: a short note the user and the Sprocket both edit. Follows the Sprocket's own edits unless the user is mid-edit. */
function MemoryField({ sprocket, onSave }: { sprocket: SprocketData; onSave(text: string): Promise<boolean> }) {
  const [memory, setMemory] = useState(sprocket.coreMemory);
  const [base, setBase] = useState(sprocket.coreMemory);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (memory.trim() === base.trim()) setMemory(sprocket.coreMemory);
    setBase(sprocket.coreMemory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprocket.coreMemory]);
  const dirty = memory.trim() !== sprocket.coreMemory;
  return (
    <form
      className="settings-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(memory)) setSaved(true);
      }}
    >
      <label htmlFor="sp-memory">Core memory</label>
      <p className="muted small">A short note that stays with {sprocket.name}, even when it moves to another project. {sprocket.name} edits it too.</p>
      <textarea
        id="sp-memory"
        className="input"
        rows={6}
        maxLength={CORE_MEMORY_MAX}
        value={memory}
        onChange={(e) => (setMemory(e.target.value), setSaved(false))}
        aria-describedby="sp-memory-count"
      />
      <div className="sp-memory-foot">
        <span id="sp-memory-count" className="muted small">{memory.length} / {CORE_MEMORY_MAX}</span>
        <span className="grow" />
        {saved && <span className="muted small" role="status">Saved</span>}
        {dirty && <button type="button" className="btn small" onClick={() => setMemory(sprocket.coreMemory)}>Undo</button>}
        <button className="btn small primary" disabled={!dirty}>Save</button>
      </div>
    </form>
  );
}
