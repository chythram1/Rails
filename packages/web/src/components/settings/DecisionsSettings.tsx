import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { IconChevronRight as ChevronRight } from "@tabler/icons-react";
import { DECISION_THRESHOLD, type DecisionEntry, type DecisionLog, type ModelSettings } from "@rails/shared";
import { api } from "../../api.ts";
import { timeAgo } from "../../util.ts";
import { socket } from "../../ws.ts";
import { Dropdown } from "../Dropdown.tsx";
import { PanelIcon } from "../PanelMenu.tsx";
import { useOpenSettings } from "./context.ts";

/**
 * Settings → Models → Fast decisions (ADR 0012, 0013): a picker and a threshold. A decision model, once picked, hears
 * the questions Rails' rules miss and wakes the Coordinator for them when it's at least as sure as the threshold, and
 * says who a team message is for (ADR 0022);
 * Off turns it off (the threshold stays, greyed out). What it decided is under a collapsed "Recent decisions", for
 * when a wake needs explaining. (`RAILS_DECISIONS=shadow`, a developer setting,
 * keeps it to judging, to evaluate a model.)
 */
export function DecisionsSettings({ settings }: { settings: ModelSettings }) {
  const openSettings = useOpenSettings();
  const [error, setError] = useState("");
  const pick = async (ref: string) => {
    setError("");
    try {
      await api.setDecisionModel(ref || null);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const options = [{ value: "", label: "Off" }, ...settings.classifiers.map((c) => ({ value: c.ref, label: c.name, group: providerName(settings, c.provider) }))];

  return (
    <section className="set-group" aria-labelledby="decisions-title">
      <h3 id="decisions-title">Fast decisions</h3>
      <p className="set-intro">
        A small, fast model hears questions Rails' rules miss, such as one without a question mark, and wakes the Coordinator
        for them. It also tells who in a team a message is for. It sees the end of sessions' messages in projects with a
        Coordinator, and teams' latest messages, which go to its provider.
      </p>
      <div className="set-row" id="setting-decision-model" data-settings-row tabIndex={-1}>
        <div className="set-text">
          <label htmlFor="decision-model">Decision model</label>
          <p>
            {!settings.decisionModel
              ? settings.classifiers.length
                ? "Off until you pick one."
                : (
                  <>
                    Connect TypeSafe (for Jev), or OpenAI with an API key (for GPT-6 Luna).{" "}
                    <button type="button" className="link" onClick={() => openSettings("providers")}>
                      Go to Providers
                    </button>
                  </>
                )
              : settings.decisionsInShadow
                ? "Judging only (RAILS_DECISIONS=shadow): it doesn't wake anyone."
                : "Wakes the Coordinator when it's at least as sure as the threshold below."}
          </p>
        </div>
        <Dropdown
          id="decision-model"
          value={settings.decisionModel ?? ""}
          options={options}
          disabled={!settings.classifiers.length}
          onChange={(v) => void pick(v)}
        />
      </div>
      <ThresholdRow value={settings.decisionThreshold} disabled={!settings.decisionModel} onError={setError} />
      {error && <p className="error" role="alert">{error}</p>}
      {settings.decisionModel && <RecentDecisions />}
    </section>
  );
}

/** How risky a threshold is, from the model's evaluation: below `caution` it starts waking for messages that ask nothing. */
export const thresholdRisk = (t: number): "safe" | "caution" | "danger" =>
  t < DECISION_THRESHOLD.danger ? "danger" : t < DECISION_THRESHOLD.caution ? "caution" : "safe";

/**
 * How sure the decision model must be to wake the Coordinator (ADR 0013): a slider in percent, its track and thumb
 * green while it's safe, amber when it gets low and red when it's low enough to wake the Coordinator often for
 * nothing (screen readers hear that in the value). A small tick marks the default. Saved a moment after it stops
 * moving. With the decision model off it stays, disabled.
 */
function ThresholdRow({ value, disabled, onError }: { value: number; disabled: boolean; onError(e: string): void }) {
  const { min, max, dialogMargin } = DECISION_THRESHOLD;
  const [pct, setPct] = useState(Math.round(value * 100));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const moving = useRef(false);
  useEffect(() => {
    if (!moving.current) setPct(Math.round(value * 100));
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (next: number) => {
    setPct(next);
    moving.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      moving.current = false;
      api.setDecisionThreshold(next / 100).then(() => onError(""), (e: Error) => onError(e.message));
    }, 400);
  };
  const risk = thresholdRisk(pct / 100);
  const at = (p: number) => (p - min * 100) / ((max - min) * 100);
  const spoken = `${pct}%${risk === "danger" ? ", low: it will often wake the Coordinator for messages that ask nothing" : risk === "caution" ? ", getting low: it may wake the Coordinator for messages that ask nothing" : ""}`;
  return (
    <div className="set-row" id="setting-decision-threshold" data-settings-row tabIndex={-1}>
      <div className="set-text">
        <label htmlFor="decision-threshold">Wake threshold</label>
        <p>How sure it must be to wake the Coordinator for a reply. A dialog needs {Math.round(dialogMargin * 100)} points more.</p>
      </div>
      <div className={`threshold ${disabled ? "off" : risk}`} style={{ "--at": at(pct), "--default": at(DECISION_THRESHOLD.default * 100) } as CSSProperties}>
        <span className="threshold-track">
          <span className="threshold-default" aria-hidden />
          <input
            id="decision-threshold"
            type="range"
            min={min * 100}
            max={max * 100}
            step={1}
            value={pct}
            disabled={disabled}
            aria-valuetext={spoken}
            onChange={(e) => change(Number(e.target.value))}
          />
        </span>
        <output htmlFor="decision-threshold" className="threshold-value" aria-hidden>{pct}%</output>
      </div>
    </div>
  );
}

const providerName = (settings: ModelSettings, id: string) => settings.providers.find((p) => p.id === id)?.name ?? id;

/**
 * The latest judgments, kept fresh while the page is open, in a native disclosure (collapsed): what it decided
 * next to what Rails' rules did, and which of its answers woke the Coordinator.
 */
function RecentDecisions() {
  const [log, setLog] = useState<DecisionLog | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setLog(await api.decisions());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "decisions.changed") void load();
    });
  }, [load]);

  if (!log) return error ? <p className="error" role="alert">{error}</p> : null;
  return (
    <details className="decision-log">
      <summary className="decision-summary">
        <ChevronRight size={14} className="decision-chevron" aria-hidden />
        Recent decisions{log.entries.length ? ` (${log.entries.length})` : ""}
      </summary>
      <p className="set-intro">{summary(log)}</p>
      {log.entries.length > 0 && (
        <ol className="decision-list" aria-label="Decisions, newest first">
          {log.entries.map((e) => (
            <Judgment key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </details>
  );
}

function summary({ summary: s, entries }: DecisionLog): string {
  if (!entries.length) return "Nothing judged yet. Judgments show up as sessions in projects with a Coordinator end their turns.";
  if (!s.judged) return "No turn ends judged yet.";
  const parts = [s.judged === 1 ? `On the one turn end so far, it ${s.agreed ? "agreed" : "disagreed"} with Rails.` : `Of the last ${s.judged} turn ends, it agreed with Rails on ${s.agreed}.`];
  if (s.missed) parts.push(`It heard a question Rails didn't ${s.missed === 1 ? "once" : `${s.missed} times`}.`);
  if (s.extra)
    parts.push(
      `Rails heard one it didn't ${s.extra === 1 ? "once" : `${s.extra} times`}${s.quiet ? `, and the Coordinator found nothing for you in ${s.quiet === s.extra ? (s.extra === 1 ? "that one" : "all of them") : s.quiet}` : ""}.`,
    );
  if (s.acted) parts.push(`It woke the Coordinator itself ${s.acted === 1 ? "once" : `${s.acted} times`}.`);
  return parts.join(" ");
}

/** One judgment: the session, what was judged, and the two verdicts side by side. */
function Judgment({ entry: e }: { entry: DecisionEntry }) {
  const differs = e.question === "turn_end" && e.answer && e.answer.label !== e.rails;
  return (
    <li className="decision">
      <p className="decision-head">
        <PanelIcon kind={e.kind} />
        <span className="decision-title truncate" title={e.title}>{e.title}</span>
        <span className="muted">{e.question === "turn_end" ? "ended its turn" : "showed a dialog"}</span>
        <span className="grow" />
        <time className="muted" dateTime={e.at} title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</time>
      </p>
      <blockquote className="decision-text">{e.text}</blockquote>
      <p className="decision-verdicts">
        <span>Rails: {e.rails}</span>
        {e.error ? (
          <span className="error">{e.error}</span>
        ) : e.answer ? (
          <span>
            Model: {e.answer.label} ({Math.round(e.answer.probability * 100)}%)
          </span>
        ) : (
          <span className="muted">Model: waiting…</span>
        )}
        {differs && <span className="decision-differs">Differs</span>}
        {e.acted && <span>Woke the Coordinator</span>}
        {e.outcome && <span>Coordinator: {e.outcome}</span>}
        {(e.model || e.latencyMs !== undefined || e.cost !== undefined) && (
          <span className="muted">
            {[e.model, e.latencyMs !== undefined && `${e.latencyMs} ms`, e.cost !== undefined && `$${e.cost < 0.01 ? e.cost.toPrecision(2) : e.cost.toFixed(2)}`].filter(Boolean).join(" · ")}
          </span>
        )}
      </p>
    </li>
  );
}
