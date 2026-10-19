import { useState } from "react";
import { IconCheck as Check } from "@tabler/icons-react";
import { sessionKey, type Suggestion } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { shortTitle } from "../../util.ts";
import { PanelIcon } from "../PanelMenu.tsx";
import { useAutoGrow } from "../useAutoGrow.ts";

/**
 * What a Coordinator drafts for a session, under its message (server suggestions.ts, ADR 0010): an answer to
 * its question (with the standing rule it followed, if any, ADR 0011) or a message the user asked it to pass
 * on. The user edits it and sends it, or dismisses it; nothing reaches the session until they send it. A
 * dialog's answer is picked in the panel, so that card links there instead. Once it's sent (or queued in a
 * busy session), dismissed or out of date, a muted line says so.
 */
export function SuggestionCard({ suggestion: s, projectId }: { suggestion: Suggestion; projectId?: string }) {
  const [text, setText] = useState(s.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = useAutoGrow(text);

  const act = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await call();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => void act(() => api.dismissSuggestion(s.id));

  if (s.status === "sent")
    return (
      <div className="sp-suggestion-done">
        <p className="sp-suggestion-line">
          <Check size={14} aria-hidden />
          <span className="sp-suggestion-label">{s.queued ? "Queued for" : "Sent to"}</span>
          <span className="sp-event-title truncate" title={s.title}>{shortTitle(s.title)}</span>
          {s.queued && <span className="sp-suggestion-label">· after its current turn</span>}
        </p>
        <blockquote className="sp-event-quote">{s.text}</blockquote>
      </div>
    );
  // A newer suggestion for the same session sits further down: this one would only be noise.
  if (s.status === "replaced") return null;
  if (s.status === "dismissed") return <p className="sp-suggestion-line">Dismissed.</p>;
  if (s.status === "expired") return <p className="sp-suggestion-line">Not sent: {lower(s.error ?? "The session moved on.")}</p>;

  const head = (
    <p className="sp-suggestion-head">
      <PanelIcon kind={s.kind} />
      <span className="sp-suggestion-label">{s.mode === "answer" ? "Answer for" : s.mode === "message" ? "Message for" : "Reply to"}</span>
      <span className="sp-event-title truncate" title={s.title}>{shortTitle(s.title)}</span>
    </p>
  );
  const rule = s.rule ? <p className="sp-suggestion-rule">Following your rule: {s.rule}</p> : null;

  if (s.mode === "answer") {
    const open = projectId && (s.sessionId && s.kind !== "shell" ? href.session(projectId, sessionKey(s.kind, s.sessionId)) : href.project(projectId));
    return (
      <div className="sp-suggestion">
        {head}
        <p className="sp-suggestion-answer">{s.text}</p>
        {rule}
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="sp-suggestion-actions">
          <span className="muted small grow">Pick this in its panel: Rails doesn't answer dialogs.</span>
          <button type="button" className="btn small" disabled={busy} onClick={dismiss}>Dismiss</button>
          {open && <a className="btn small primary" href={open}>Open panel</a>}
        </div>
      </div>
    );
  }

  const sending = busy || s.status === "sending";
  const send = () => {
    if (text.trim() && !sending) void act(() => api.sendSuggestion(s.id, text));
  };
  const problem = error || (s.status === "failed" && s.error ? `Not sent: ${s.error}` : "");
  return (
    <form
      className="sp-suggestion"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {head}
      <textarea
        ref={field}
        className="sp-suggestion-text"
        aria-label={`${s.mode === "message" ? "Message for" : "Reply to"} ${s.title}`}
        rows={1}
        maxLength={4000}
        value={text}
        disabled={sending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      {rule}
      {problem && <p className="error small" role="alert">{problem}</p>}
      <div className="sp-suggestion-actions">
        <button type="button" className="btn small" disabled={sending} onClick={dismiss}>Dismiss</button>
        <button className="btn small primary" disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}

/** "The session moved on." → "the session moved on.", to follow "Not sent:". */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
