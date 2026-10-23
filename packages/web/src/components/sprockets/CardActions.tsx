import { useState } from "react";
import { IconCheck as Check, IconChevronRight as ChevronRight, IconPlayerSkipForward as Skipped, IconPlug as Plug, IconX as X } from "@tabler/icons-react";
import type { SprocketCardAction } from "@rails/shared";
import { api } from "../../api.ts";
import { gist, readable, readableResult } from "./readable.ts";

const Args = ({ args }: { args: Record<string, unknown> }) => {
  const list = Object.entries(args);
  return list.length ? (
    <dl className="chat-card-facts approval-args">
      {list.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={v !== null && typeof v === "object" ? "card-action-nested" : undefined}>{readable(v)}</dd>
        </div>
      ))}
    </dl>
  ) : null;
};

const DONE_LABEL: Record<Exclude<SprocketCardAction["status"], "waiting">, string> = {
  running: "Running…",
  done: "Ran",
  failed: "Failed",
  skipped: "Skipped",
};

/**
 * A card's actions (ADR 0031, server cardActions.ts): each a call to one of the Sprocket's MCP tools, shown with its
 * service, tool and arguments, to Run or Skip; Run all when more than one waits. Run is the approval. A tool its server
 * marks destructive asks once more on the button. Once settled, an action is one line with its outcome, its
 * arguments and result folded inside. The Sprocket goes on once every action is settled.
 */
export function CardActions({ messageId, actions }: { messageId: string; actions: SprocketCardAction[] }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<number | "all" | null>(null);
  const [error, setError] = useState("");
  const act = async (run: boolean, index?: number) => {
    setError("");
    setBusy(true);
    setConfirming(null);
    try {
      await api.actOnCard(messageId, run, index);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = actions.filter((a) => a.status === "waiting");
  const allDestructive = waiting.some((a) => a.destructive);

  return (
    <div className="card-actions">
      <ul className="card-action-list">
        {actions.map((a, i) => {
          const tool = (
            <span className="approval-tool">
              {a.server} · {a.tool}
            </span>
          );
          if (a.status !== "waiting")
            return (
              <li key={i} className={"card-action decided " + a.status}>
                <details>
                  <summary className="approval-summary">
                    {a.status === "skipped" ? <Skipped size={14} aria-hidden /> : a.status === "failed" ? <X size={14} aria-hidden /> : <Check size={14} aria-hidden />}
                    <span className="card-action-label">{a.label}</span>
                    {gist(a.args) && <span className="card-action-gist">{gist(a.args)}</span>}
                    <span className="card-action-state" role="status">
                      {DONE_LABEL[a.status]}
                    </span>
                    <ChevronRight size={14} className="approval-chevron" aria-hidden />
                  </summary>
                  <p className="card-action-tool">{tool}</p>
                  <Args args={a.args} />
                  {a.result && (
                    <div className="approval-result-wrap">
                      <p className="approval-result-label">{a.status === "failed" ? "What went wrong" : "What it returned"}</p>
                      <div className="approval-result">{readableResult(a.result)}</div>
                    </div>
                  )}
                </details>
              </li>
            );
          const sure = confirming === i;
          return (
            <li key={i} className="card-action waiting">
              <p className="card-action-head">
                <Plug size={14} aria-hidden />
                <span className="card-action-label">{a.label}</span>
              </p>
              <p className="card-action-tool">
                {tool}
                {a.destructive && <span className="card-action-tag">Destructive</span>}
              </p>
              <Args args={a.args} />
              <div className="approval-actions">
                {sure && <span className="card-action-warn">{a.server} marks this as destructive.</span>}
                <span className="grow" />
                <button type="button" className="btn small" disabled={busy} onClick={() => (sure ? setConfirming(null) : void act(false, i))}>
                  {sure ? "Cancel" : "Skip"}
                </button>
                <button
                  type="button"
                  className={"btn small primary"}
                  disabled={busy}
                  aria-label={sure ? `Yes, run "${a.label}"` : `Run "${a.label}"`}
                  onClick={() => (a.destructive && !sure ? setConfirming(i) : void act(true, i))}
                >
                  {sure ? "Yes, run it" : "Run"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {(waiting.length > 1 || error) && (
        <div className="approval-actions card-actions-foot">
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          {confirming === "all" && (
            <span className="card-action-warn">
              {waiting.filter((a) => a.destructive).length === 1 ? "One of these is marked destructive." : "Some of these are marked destructive."}
            </span>
          )}
          <span className="grow" />
          {waiting.length > 1 && (
            <>
              {confirming === "all" && (
                <button type="button" className="btn small" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn small primary"
                disabled={busy}
                onClick={() => (allDestructive && confirming !== "all" ? setConfirming("all") : void act(true))}
              >
                {busy ? "Running…" : confirming === "all" ? "Yes, run all" : "Run all"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
