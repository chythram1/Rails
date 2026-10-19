import { useCallback, useEffect, useState } from "react";
import type { DecisionEntry, DecisionLog, ModelSettings } from "@rails/shared";
import { api } from "../../api.ts";
import { timeAgo } from "../../util.ts";
import { socket } from "../../ws.ts";
import { Dropdown } from "../Dropdown.tsx";
import { PanelIcon } from "../PanelMenu.tsx";

/**
 * Settings → Models → Fast decisions (ADR 0012): the decision model that judges in shadow, off by default, and
 * its log: each judgment next to what Rails decided in code, so the user can see whether it would do better.
 */
export function DecisionsSettings({ settings }: { settings: ModelSettings }) {
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
        A small, fast model can judge what Rails decides with simple rules, such as whether a session's last message asks you
        something. For now it only watches: its answers go in the log below, next to what Rails did. It sees the end of
        sessions' messages in projects with a Coordinator, which go to its provider.
      </p>
      <div className="set-row" id="setting-decision-model" data-settings-row tabIndex={-1}>
        <div className="set-text">
          <label htmlFor="decision-model">Decision model</label>
          <p>
            {settings.decisionModel
              ? "Judging in shadow: nothing acts on its answers."
              : settings.classifiers.length
                ? "Off until you pick one."
                : "Set up TypeSafe (for Jev) or OpenAI with an API key (for GPT-6 Luna) under Providers."}
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
      {settings.decisionModel && <ShadowLog />}
    </section>
  );
}

const providerName = (settings: ModelSettings, id: string) => settings.providers.find((p) => p.id === id)?.name ?? id;

/** The latest judgments, kept fresh while the page is open. */
function ShadowLog() {
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
    <div className="decision-log">
      <h4 className="set-label">Shadow log</h4>
      <p className="set-intro" role="status">{summary(log)}</p>
      {log.entries.length > 0 && (
        <ol className="decision-list" aria-label="Judgments, newest first">
          {log.entries.map((e) => (
            <Judgment key={e.id} entry={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function summary({ summary: s, entries }: DecisionLog): string {
  if (!entries.length) return "Nothing judged yet. Judgments show up as sessions in projects with a Coordinator end their turns.";
  if (!s.judged) return "No turn ends judged yet.";
  const parts = [`Of the last ${s.judged} turn ends, it agreed with Rails on ${s.agreed}.`];
  if (s.missed) parts.push(`It heard a question Rails didn't ${s.missed === 1 ? "once" : `${s.missed} times`}.`);
  if (s.extra)
    parts.push(
      `Rails heard one it didn't ${s.extra === 1 ? "once" : `${s.extra} times`}${s.quiet ? `, and the Coordinator found nothing for you in ${s.quiet === s.extra ? (s.extra === 1 ? "that one" : "all of them") : s.quiet}` : ""}.`,
    );
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
