import { useState } from "react";
import { IconCheck as Check, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import { sessionKey, type Suggestion } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { shortTitle } from "../../util.ts";
import { PanelIcon } from "../workspace/PanelMenu.tsx";
import { useAutoGrow } from "../ui/useAutoGrow.ts";

/**
 * What a Coordinator drafts for a session, under its message (server suggestions.ts, ADR 0010): an answer to
 * its question (with the standing rule it followed, if any, ADR 0011) or a message the user asked it to pass
 * on. The user edits it and sends it, or dismisses it; nothing reaches the session until they send it. A
 * dialog's answer is picked in the panel, so that card links there, unless Rails can answer a pi dialog itself (ADR
 * 0027): then it has Send too. Once it's sent (or queued in a
 * busy session), dismissed or out of date, a muted line says so. A handoff's message also carries what the
 * finished session said last (ADR 0015), sent as it is under the text: collapsed, to read if you want. A message
 * an agent drafted (ADR 0018) says which session wrote it, as plainly as the text: pi and Codex take what the user
 * sends as the user's own instruction.
 */
function Attachment({ attachment }: { attachment: NonNullable<Suggestion["attachment"]> }) {
  return (
    <details className="sp-attachment">
      <summary className="sp-attachment-summary">
        <ChevronRight size={14} className="sp-attachment-chevron" aria-hidden />
        <span className="truncate">Includes what {shortTitle(attachment.title)} said when it finished</span>
      </summary>
      <div className="sp-attachment-text">{attachment.text}</div>
    </details>
  );
}

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
        {s.unconfirmed && <p className="sp-suggestion-warn">No sign it got there yet. Check its panel before you send it again.</p>}
        <blockquote className="sp-event-quote">{s.text}</blockquote>
        {s.attachment && <Attachment attachment={s.attachment} />}
      </div>
    );
  // A newer suggestion for the same session sits further down: this one would only be noise. An agent's message
  // keeps a line, since its event row says who wanted to tell whom.
  if (s.status === "replaced") return s.from ? <p className="sp-suggestion-line">Replaced by a newer message.</p> : null;
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
    // A pi dialog Rails can answer (ADR 0027) gets Send; others are picked in the panel.
    const sending = busy || s.status === "sending";
    const problem = error || (s.status === "failed" && s.error ? `Not sent: ${s.error}` : "");
    return (
      <div className="sp-suggestion">
        {head}
        <p className="sp-suggestion-answer">{s.text}</p>
        {rule}
        {problem && <p className="error small" role="alert">{problem}</p>}
        <div className="sp-suggestion-actions">
          <span className="muted small grow">{s.dialog ? "Sending picks this in its dialog." : "Pick this in its panel: Rails can't answer this dialog."}</span>
          <button type="button" className="btn small" disabled={sending} onClick={dismiss}>Dismiss</button>
          {s.dialog ? (
            <>
              {open && <a className="btn small" href={open}>Open panel</a>}
              <button type="button" className="btn small primary" disabled={sending} onClick={() => void act(() => api.sendSuggestion(s.id, s.text))}>
                {sending ? "Sending…" : "Send"}
              </button>
            </>
          ) : (
            open && <a className="btn small primary" href={open}>Open panel</a>
          )}
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
      {s.from && (
        <p className="sp-suggestion-from">
          Written by the session “<span title={s.from.title}>{shortTitle(s.from.title)}</span>”. Send it only if you’d say it yourself.
        </p>
      )}
      {s.attachment && <Attachment attachment={s.attachment} />}
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
