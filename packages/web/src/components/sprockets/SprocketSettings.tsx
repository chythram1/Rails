import { useEffect, useState } from "react";
import { IconChevronLeft as ChevronLeft } from "@tabler/icons-react";
import { CORE_MEMORY_MAX, type Sprocket as SprocketData, type SprocketSettings as Settings } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ModelSelect, useModelSettings } from "../ModelSelect.tsx";
import { useOpenSettings } from "../settings/context.ts";
import { Sprocket } from "./Sprocket.tsx";

/**
 * A Sprocket's settings (ADR 0006): the project it's attached to, the model it runs on and its core
 * memory. Moving it to another project deletes its chat there, so that asks first; its name, look and
 * core memory stay.
 */
export function SprocketSettings({ sprocket }: { sprocket: SprocketData }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const { settings: models } = useModelSettings();
  const openSettings = useOpenSettings();
  const [memory, setMemory] = useState(sprocket.coreMemory);
  const [base, setBase] = useState(sprocket.coreMemory);
  // The Sprocket can edit its memory meanwhile (or another device can): follow along unless the user is editing.
  useEffect(() => {
    if (memory.trim() === base.trim()) setMemory(sprocket.coreMemory);
    setBase(sprocket.coreMemory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprocket.coreMemory]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const save = async (body: Settings) => {
    setError("");
    setSaved(false);
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
    const hasChat = !!sprocket.lastMessage;
    const question = to ? `Attach ${name} to ${to.name}?` : `Detach ${name} from its project?`;
    if (hasChat && !confirm(`${question}\n\nIts chat is deleted. Its name, look and core memory stay.`)) return;
    await save({ projectId: projectId || null });
  };

  const defaultName = models?.models.find((m) => m.ref === models.defaultModel)?.name;
  const memoryDirty = memory.trim() !== sprocket.coreMemory;

  return (
    <section className="sp-chat" aria-labelledby="sp-settings-title">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.sprocket(id)} aria-label={`Back to the chat with ${name}`}>
          <ChevronLeft size={18} />
        </a>
        <Sprocket look={sprocket.look} size={28} seed={id} />
        <h2 id="sp-settings-title" className="truncate">{name} settings</h2>
      </header>
      <div className="sp-thread">
        <div className="sp-settings">
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

          <form
            className="settings-field"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await save({ coreMemory: memory })) setSaved(true);
            }}
          >
            <label htmlFor="sp-memory">Core memory</label>
            <p className="muted small">A short note that stays with {name}, even when it moves to another project. {name} edits it too.</p>
            <textarea
              id="sp-memory"
              className="input"
              rows={7}
              maxLength={CORE_MEMORY_MAX}
              value={memory}
              onChange={(e) => (setMemory(e.target.value), setSaved(false))}
              aria-describedby="sp-memory-count"
            />
            <div className="provider-main">
              <span id="sp-memory-count" className="muted small">{memory.length} / {CORE_MEMORY_MAX}</span>
              <span className="grow" />
              {saved && <span className="muted small" role="status">Saved</span>}
              {memoryDirty && <button type="button" className="btn small" onClick={() => setMemory(sprocket.coreMemory)}>Undo</button>}
              <button className="btn small primary" disabled={!memoryDirty}>Save</button>
            </div>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    </section>
  );
}
