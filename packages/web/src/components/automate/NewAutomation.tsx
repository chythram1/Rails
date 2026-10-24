import { useState } from "react";
import { AUTOMATION_NAME_MAX, AUTOMATION_PROMPT_MAX, type AutomationSchedule, type McpServer, type Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { Dropdown } from "../ui/Dropdown.tsx";
import { EditorHead } from "../customize/fields.tsx";
import { Sprocket } from "../sprockets/Sprocket.tsx";
import { ScheduleField } from "./ScheduleField.tsx";
import type { AutomationTemplate, TemplateUse } from "./templates.ts";
import { useName } from "./Templates.tsx";
import { localTimezone } from "./useAutomations.ts";

/** Its Sprocket, as the Dropdown lists them: the face and the name. */
export const sprocketOptions = (sprockets: SprocketData[]) =>
  sprockets.map((s) => ({ value: s.id, label: s.name, icon: <Sprocket look={s.look} size={18} seed={s.id} still /> }));

/** Whether a Sprocket has a template's use: it's attached to a project, or has the connector among its tools. */
function canUse(s: SprocketData, u: TemplateUse, servers: McpServer[]) {
  return u === "project" ? !!s.projectId : servers.some((m) => m.connector === u && s.tools.mcp.includes(m.id));
}
/** How much of a template a Sprocket can do: how many of its uses it has. */
const fit = (s: SprocketData, t: AutomationTemplate, servers: McpServer[]) => t.uses.filter((u) => canUse(s, u, servers)).length;

/**
 * A new automation, as a draft in the editor's head and rows: nothing is saved until Create. From a template, it starts
 * filled in, with a Sprocket that can do it if there is one, and says what's missing if the chosen one can't.
 */
export function NewAutomation({ sprockets, servers, template }: { sprockets: SprocketData[]; servers: McpServer[]; template?: AutomationTemplate }) {
  const [name, setName] = useState(template?.name ?? "");
  // From a template, the Sprocket that can do most of it (the first, on a tie).
  const [sprocketId, setSprocketId] = useState(
    (template && [...sprockets].sort((a, b) => fit(b, template, servers) - fit(a, template, servers))[0]?.id) ?? sprockets[0]?.id ?? "",
  );
  const [prompt, setPrompt] = useState(template?.prompt ?? "");
  const [schedule, setSchedule] = useState<AutomationSchedule>(template?.schedule ?? { kind: "weekdays", time: "09:00" });
  const [timezone, setTimezone] = useState(localTimezone);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = !!name.trim() && !!prompt.trim() && !!sprocketId && !busy;
  const chosen = sprockets.find((s) => s.id === sprocketId);
  const lacks = template && chosen && fit(chosen, template, servers) < template.uses.length ? missing(chosen, template, servers) : null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await api.createAutomation({ name, sprocketId, prompt, schedule, timezone });
      navigate(href.automate());
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
      <EditorHead back={template ? href.automateTemplates() : href.automate()} backLabel={template ? "Templates" : "Automate"} title="New automation" />
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
          {lacks && (
            <p className="au-lacks" role="status">
              {lacks}
            </p>
          )}
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
            <a className="btn" href={template ? href.automateTemplates() : href.automate()}>
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

/** What the chosen Sprocket would need for a template, and where to give it that (in a new tab, so the draft stays). */
function missing(s: SprocketData, t: AutomationTemplate, servers: McpServer[]) {
  const settings = (
    <a href={href.sprocketSettings(s.id)} target="_blank" rel="noreferrer">
      {s.name}'s settings
    </a>
  );
  const lacking = t.uses.filter((u) => !canUse(s, u, servers));
  const toAdd = lacking.filter((u) => u !== "project" && !servers.some((m) => m.connector === u));
  const toTurnOn = lacking.filter((u) => u !== "project" && !toAdd.includes(u));
  const names = (list: TemplateUse[], link: boolean) =>
    list.map((u, i) => (
      <span key={u}>
        {i > 0 && (i === list.length - 1 ? " and " : ", ")}
        {link ? (
          <a href={href.connector(u)} target="_blank" rel="noreferrer">
            {useName(u)}
          </a>
        ) : (
          useName(u)
        )}
      </span>
    ));
  return (
    <>
      {lacking.includes("project") && <>{s.name} has no project, so it can't see agent sessions, git or files: attach it to one in {settings}.{" "}</>}
      {toAdd.length > 0 && (
        <>
          Add {names(toAdd, true)} in Customize, then turn {toAdd.length > 1 ? "them" : "it"} on for {s.name} under Tools.{" "}
        </>
      )}
      {toTurnOn.length > 0 && (
        <>
          Turn on {names(toTurnOn, false)} for {s.name} under Tools in {settings}.
        </>
      )}
    </>
  );
}
