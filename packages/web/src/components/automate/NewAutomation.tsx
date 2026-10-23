import { useState } from "react";
import { AUTOMATION_NAME_MAX, AUTOMATION_PROMPT_MAX, type AutomationSchedule, type Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { Dropdown } from "../Dropdown.tsx";
import { EditorHead } from "../customize/fields.tsx";
import { Sprocket } from "../sprockets/Sprocket.tsx";
import { ScheduleField } from "./ScheduleField.tsx";
import { localTimezone } from "./useAutomations.ts";

/** Its Sprocket, as the Dropdown lists them: the face and the name. */
export const sprocketOptions = (sprockets: SprocketData[]) =>
  sprockets.map((s) => ({ value: s.id, label: s.name, icon: <Sprocket look={s.look} size={18} seed={s.id} still /> }));

/** A new automation, as a draft in the editor's head and rows: nothing is saved until Create. */
export function NewAutomation({ sprockets }: { sprockets: SprocketData[] }) {
  const [name, setName] = useState("");
  const [sprocketId, setSprocketId] = useState(sprockets[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState<AutomationSchedule>({ kind: "weekdays", time: "09:00" });
  const [timezone, setTimezone] = useState(localTimezone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !!name.trim() && !!prompt.trim() && !!sprocketId && !busy;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.createAutomation({ name, sprocketId, prompt, schedule, timezone });
      navigate(href.automation(made.id));
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  if (!sprockets.length)
    return (
      <div className="cz-gone">
        <p className="muted">An automation is run by a Sprocket. Make one first.</p>
        <a href={href.newSprocket()}>New Sprocket</a>
      </div>
    );

  return (
    <form className="cz-editor" onSubmit={create}>
      <EditorHead back={href.automate()} backLabel="Automate" title="New automation" />
      <div className="cz-body">
        <section className="set-group" aria-labelledby="au-new-title">
          <h3 id="au-new-title">Automation</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="au-new-name">Name</label>
              <p>Shown in Automate and on its line in the chat.</p>
            </div>
            <input id="au-new-name" className="input" maxLength={AUTOMATION_NAME_MAX} placeholder="Morning brief" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="au-new-sprocket">Sprocket</label>
              <p id="au-new-sprocket-help">Runs it with its model, rules, connectors and skills, in its chat.</p>
            </div>
            <Dropdown id="au-new-sprocket" value={sprocketId} options={sprocketOptions(sprockets)} onChange={setSprocketId} describedBy="au-new-sprocket-help" />
          </div>
        </section>
        <div className="settings-field">
          <label htmlFor="au-new-prompt">Instructions</label>
          <p id="au-new-prompt-help" className="muted small">
            What the Sprocket does each time, as you'd ask it in its chat. Say what's worth telling you: when there's nothing, it posts nothing.
          </p>
          <textarea
            id="au-new-prompt"
            className="input"
            rows={6}
            maxLength={AUTOMATION_PROMPT_MAX}
            placeholder="Check Linear for issues assigned to me that changed since the last run, and list them with what changed."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            aria-describedby="au-new-prompt-help"
          />
        </div>
        <section className="set-group" aria-labelledby="au-new-when">
          <h3 id="au-new-when">Schedule</h3>
          <ScheduleField id="au-new" schedule={schedule} timezone={timezone} onChange={(s, z) => (setSchedule(s), setTimezone(z))} />
        </section>
        <div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="au-actions">
            <a className="btn" href={href.automate()}>
              Cancel
            </a>
            <button className="btn primary" disabled={!ready}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
