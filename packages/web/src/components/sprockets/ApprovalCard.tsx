import { useState } from "react";
import { IconCheck as Check, IconChevronRight as ChevronRight, IconPlug as Plug, IconX as X } from "@tabler/icons-react";
import type { SprocketApproval } from "@rails/shared";
import { api } from "../../api.ts";

/** An argument's value in a line: text as it is, the rest as JSON. */
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * A call a Sprocket asked to make to an MCP tool set to ask (ADR 0025, server approvals.ts): the tool and its
 * arguments, then Deny and Allow. Once decided, one line saying what came of it, with the arguments and result folded
 * inside it to read if you want.
 * The Sprocket goes on in its next turn either way.
 */
export function ApprovalCard({ messageId, approval: a, name }: { messageId: string; approval: SprocketApproval; name: string }) {
  const [busy, setBusy] = useState<"allow" | "deny" | "">("");
  const [error, setError] = useState("");
  const decide = async (allow: boolean) => {
    setError("");
    setBusy(allow ? "allow" : "deny");
    try {
      await api.decideApproval(messageId, allow);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const args = Object.entries(a.args);
  const facts = args.length > 0 && (
    <dl className="chat-card-facts approval-args">
      {args.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
  const tool = (
    <span className="approval-tool">
      {a.server} · {a.tool}
    </span>
  );

  if (a.status !== "pending") {
    const label = a.status === "running" ? "Allowed, running…" : a.status === "done" ? "Allowed" : a.status === "denied" ? "Denied" : "Allowed, but it failed";
    return (
      <section className={"chat-card approval decided " + a.status} aria-label={`${name} asked to use ${a.server} ${a.tool}: ${label}`}>
        <details>
          <summary className="approval-summary">
            {a.status === "denied" ? <X size={14} aria-hidden /> : a.status === "failed" ? <X size={14} aria-hidden /> : <Check size={14} aria-hidden />}
            <span className="approval-label" role="status">
              {label}
            </span>
            {tool}
            <span className="grow" />
            <ChevronRight size={14} className="approval-chevron" aria-hidden />
          </summary>
          {facts}
          {a.status === "denied" && <p className="approval-note">It didn't run.</p>}
          {a.result && (
            <div className="approval-result-wrap">
              <p className="approval-result-label">{a.status === "failed" ? "What went wrong" : "What it returned"}</p>
              <div className="approval-result">{a.result}</div>
            </div>
          )}
        </details>
      </section>
    );
  }

  return (
    <section className="chat-card approval pending" aria-label={`${name} wants to use ${a.server} ${a.tool}`}>
      <p className="approval-head">
        <Plug size={14} aria-hidden />
        <span className="approval-label">Wants to use</span>
        {tool}
        <span className="approval-wait">
          <span className="approval-dot" aria-hidden />
          Waiting for you
        </span>
      </p>
      {facts}
      <div className="approval-actions">
        {error && <p className="error small" role="alert">{error}</p>}
        <span className="grow" />
        <button type="button" className="btn small" disabled={!!busy} onClick={() => void decide(false)}>
          Deny
        </button>
        <button type="button" className="btn small primary" disabled={!!busy} onClick={() => void decide(true)}>
          {busy === "allow" ? "Running…" : "Allow"}
        </button>
      </div>
    </section>
  );
}
