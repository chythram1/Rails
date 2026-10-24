import { useEffect, useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import { AUTOMATION_NAME_MAX, AUTOMATION_PROMPT_MAX, type Automation, type AutomationInput, type AutomationRun, type AutomationSchedule, type Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { timeAgo } from "../../util.ts";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { Dropdown } from "../ui/Dropdown.tsx";
import { MenuButton } from "../ui/Menu.tsx";
import { Switch } from "../ui/Switch.tsx";
import { EditorHead, LongText, TextInput } from "../customize/fields.tsx";
import { sprocketOptions } from "./NewAutomation.tsx";
import { ScheduleField } from "./ScheduleField.tsx";
import { OUTCOME, useAutomation, when } from "./useAutomations.ts";

/**
 * One automation (ADR 0032): whether it's on and when it runs next (or why Rails paused it), its settings as Settings
 * rows that save as you go, the schedule with Save, the instructions, and its runs, newest first.
 */
export function AutomationEditor({ id, sprockets }: { id: string; sprockets: SprocketData[] }) {
  const { data, missing } = useAutomation(id);
  if (missing)
    return (
      <div className="cz-gone">
        <p className="muted">This automation doesn't exist anymore. It may have been deleted on another device.</p>
        <a href={href.automate()}>Back to Automate</a>
      </div>
    );
  if (!data) return null;
  return <Editor automation={data.automation} runs={data.runs} sprockets={sprockets} />;
}

function Editor({ automation: a, runs, sprockets }: { automation: Automation; runs: AutomationRun[]; sprockets: SprocketData[] }) {
  const [error, setError] = useState("");
  const running = runs[0]?.outcome === "running";
  const sprocket = sprockets.find((s) => s.id === a.sprocketId);

  const save = async (body: AutomationInput) => {
    setError("");
    try {
      await api.updateAutomation(a.id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };
  const runNow = async () => {
    setError("");
    try {
      await api.runAutomation(a.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const [confirmDialog, ask] = useConfirm();
  const remove = () =>
    ask({
      title: `Delete ${a.name}?`,
      text: "It stops running. What its runs posted stays in the Sprocket's chat.",
      action: "Delete automation",
      danger: true,
      returnFocus: () => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`${a.name} actions`)}"]`),
      onConfirm: async () => {
        await api.deleteAutomation(a.id);
        navigate(href.automate());
      },
    });

  return (
    <div className="cz-editor">
      {confirmDialog}
      <EditorHead back={href.automate()} backLabel="Automate" title={a.name}>
        <button type="button" className="btn small" disabled={running} title={running ? "It's running now" : undefined} onClick={() => void runNow()}>
          {running ? "Running…" : "Run now"}
        </button>
        <MenuButton label={`${a.name} actions`} title="More" icon={<Dots size={18} />} align="right" items={[{ label: "Delete automation", danger: true, onSelect: () => void remove() }]} />
      </EditorHead>
      <div className="cz-body">
        <div className="au-state">
          {a.pausedReason ? (
            <p className="cz-status">
              <span className="cz-dot needed" aria-hidden /> Paused. {a.pausedReason} Turn it on again once that's fixed.
            </p>
          ) : (
            <p className="cz-status">
              <span className={`cz-dot ${a.enabled ? "ok" : ""}`} aria-hidden />
              {a.enabled ? (a.nextRunAt ? `On. Next run ${when(a.nextRunAt)}, your time.` : "On, but its schedule doesn't run again.") : "Off. It runs only when you run it now."}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <section className="set-group" aria-labelledby="au-settings">
          <h3 id="au-settings">Automation</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="au-on">On</label>
              <p id="au-on-help">Runs on its schedule while Rails' server is on.</p>
            </div>
            <Switch id="au-on" checked={a.enabled} aria-describedby="au-on-help" onChange={(on) => void save({ enabled: on })} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="au-name">Name</label>
              <p>Shown in Automate and on its line in the chat.</p>
            </div>
            <TextInput id="au-name" value={a.name} maxLength={AUTOMATION_NAME_MAX} onSave={(v) => save({ name: v })} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="au-sprocket">Sprocket</label>
              <p id="au-sprocket-help">
                Runs it in its chat{sprocket ? (
                  <>
                    {" ("}
                    <a href={href.sprocket(sprocket.id)}>open {sprocket.name}'s chat</a>)
                  </>
                ) : null}
                .
              </p>
            </div>
            <Dropdown id="au-sprocket" value={a.sprocketId} options={sprocketOptions(sprockets)} onChange={(v) => void save({ sprocketId: v })} describedBy="au-sprocket-help" />
          </div>
        </section>
        <LongText
          id="au-prompt"
          label="Instructions"
          help="What the Sprocket does each time. Say what's worth telling you: when there's nothing, it posts nothing."
          value={a.prompt}
          maxLength={AUTOMATION_PROMPT_MAX}
          rows={6}
          onSave={(v) => save({ prompt: v })}
        />
        <Schedule a={a} />
        <Runs runs={runs} sprocketId={sprocket?.id} />
      </div>
    </div>
  );
}

/**
 * The schedule, changed in place and saved with Save (a time half typed shouldn't move the next run). A schedule Rails
 * refuses says why under it.
 */
function Schedule({ a }: { a: Automation }) {
  const [schedule, setSchedule] = useState<AutomationSchedule>(a.schedule);
  const [timezone, setTimezone] = useState(a.timezone);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setError("");
    try {
      await api.updateAutomation(a.id, { schedule, timezone });
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const stored = JSON.stringify([a.schedule, a.timezone]);
  useEffect(() => {
    setSchedule(a.schedule);
    setTimezone(a.timezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the stored one changes
  }, [stored]);
  const dirty = JSON.stringify([schedule, timezone]) !== stored;
  return (
    <section className="set-group" aria-labelledby="au-when">
      <h3 id="au-when">Schedule</h3>
      <ScheduleField id="au" schedule={schedule} timezone={timezone} onChange={(s, z) => (setSchedule(s), setTimezone(z), setSaved(false), setError(""))} />
      <div className="sp-field-foot">
        {error && (
          <span className="error small" role="alert">
            {error}
          </span>
        )}
        <span className="grow" />
        {saved && !dirty && (
          <span className="muted small" role="status">
            Saved
          </span>
        )}
        {dirty && (
          <button type="button" className="btn small" onClick={() => (setSchedule(a.schedule), setTimezone(a.timezone))}>
            Undo
          </button>
        )}
        <button type="button" className="btn small primary" disabled={!dirty} onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  );
}

/** Its runs, newest first: how each went, when, what started it, and its one line. */
function Runs({ runs, sprocketId }: { runs: AutomationRun[]; sprocketId?: string }) {
  return (
    <section className="set-group" aria-labelledby="au-runs">
      <h3 id="au-runs">Runs</h3>
      {!runs.length ? (
        <p className="set-intro">No runs yet. Run it now to see what it does before its first scheduled run.</p>
      ) : (
        <ul className="au-runs">
          {runs.map((r) => (
            <li key={r.id} className="au-run">
              <span className="au-run-head">
                <span className={`cz-dot ${OUTCOME[r.outcome].tone}`} aria-hidden />
                <span className="au-run-outcome">{OUTCOME[r.outcome].label}</span>
                <span className="muted" title={new Date(r.createdAt).toLocaleString()}>
                  {timeAgo(r.createdAt)} · {r.trigger === "manual" ? "Run now" : "Scheduled"}
                </span>
                {sprocketId && r.outcome !== "skipped" && r.outcome !== "quiet" && (
                  <a className="au-run-link" href={href.sprocket(sprocketId)}>
                    In the chat
                  </a>
                )}
              </span>
              {r.summary && <span className="au-run-summary">{r.summary}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
