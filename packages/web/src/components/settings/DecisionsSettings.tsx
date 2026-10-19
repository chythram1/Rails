import { useCallback, useEffect, useState } from "react";
import { IconChevronRight as ChevronRight } from "@tabler/icons-react";
import type { DecisionEntry, DecisionLog, ModelSettings } from "@rails/shared";
import { api } from "../../api.ts";
import { timeAgo } from "../../util.ts";
import { socket } from "../../ws.ts";
import { Dropdown } from "../Dropdown.tsx";
import { PanelIcon } from "../PanelMenu.tsx";
import { useOpenSettings } from "./context.ts";

/**
 * Settings → Models → Fast decisions (ADR 0012, 0013): one picker. A decision model, once picked, hears the
 * questions Rails' rules miss and wakes the Coordinator for them; Off turns it off. What it decided is under a
 * collapsed "Recent decisions", for when a wake needs explaining. (`RAILS_DECISIONS=shadow`, a developer setting,
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
        for them. It sees the end of sessions' messages in projects with a Coordinator, which go to its provider.
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
                : "Wakes the Coordinator when it's sure: 90% for a reply, 95% for a dialog."}
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
      {error && <p className="error" role="alert">{error}</p>}
      {settings.decisionModel && <RecentDecisions />}
    </section>
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
