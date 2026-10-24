import { sessionKey, type SprocketMessage } from "@rails/shared";
import { href } from "../../router.ts";
import { shortTitle } from "../../util.ts";
import { PanelIcon } from "../workspace/PanelMenu.tsx";

/**
 * A session waiting for the user, as Rails puts it in its Coordinator's chat (server watches.ts): which
 * session, what it asked (the dialog's questions, or the end of its last message), and a link to its
 * panel. Or a session that changed files other sessions changed shortly before (overlaps.ts, ADR 0014):
 * which sessions, and the files. Or a session a handoff waits for that finished a turn (ADR 0015): which
 * session it's for and what to pass on. Or an agent's message for another session (ADR 0018): only who wants to
 * tell, since the draft card under it names the session it's for and holds the text. The Coordinator's take
 * follows as a normal reply; when it found nothing for the user, a line says so.
 */
export function EventRow({ message, projectId, name }: { message: SprocketMessage; projectId?: string; name: string }) {
  const e = message.event!;
  const open = projectId && (e.kind === "shell" || !e.sessionId ? href.project(projectId) : href.session(projectId, sessionKey(e.kind, e.sessionId)));
  return (
    <div className="sp-event">
      <p className="sp-event-head">
        <PanelIcon kind={e.kind} />
        <span className="sp-event-title truncate" title={e.title}>{shortTitle(e.title)}</span>
        <span className="sp-event-what">{e.what === "message" ? "wants to tell" : e.what === "handoff" ? "finished a turn; hand off to" : e.what === "overlap" ? (e.overlaps?.every((o) => o.owns) ? "changed files owned by" : "changed the same files as") : e.what === "finding" ? (e.findings?.length ? "found something for" : "found something for another session") : e.what === "turn_end" ? "is waiting for your reply" : e.what === "permission" ? "is waiting for your permission" : "is asking you"}</span>
        {open && (
          <a className="sp-event-open" href={open}>
            Open<span className="sr-only"> {e.title}</span>
          </a>
        )}
      </p>
      {e.what === "message" ? null : e.what === "handoff" && e.handoff ? (
        <ul className="sp-event-quote">
          <li>
            <span className="sp-event-with">
              <PanelIcon kind={e.handoff.to.kind} />
              <span className="truncate" title={e.handoff.to.title}>{shortTitle(e.handoff.to.title)}</span>
            </span>
            <span className="sp-event-options">{e.handoff.note}</span>
          </li>
        </ul>
      ) : e.what === "overlap" ? (
        <ul className="sp-event-quote">
          {e.overlaps?.map((o) => (
            <li key={o.panelId}>
              <span className="sp-event-with">
                <PanelIcon kind={o.kind} />
                <span className="truncate" title={o.title}>{shortTitle(o.title)}</span>
                {o.owns && !e.overlaps?.every((x) => x.owns) && <span className="sp-event-owns">owns</span>}
              </span>
              <span className="sp-event-files">{o.files.join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : e.what === "finding" ? (
        <>
          {!!e.findings?.length && <ul className="sp-event-quote">
            {e.findings.map((f) => (
              <li key={f.panelId}>
                <span className="sp-event-with">
                  <PanelIcon kind={f.kind} />
                  <span className="truncate" title={f.title}>{shortTitle(f.title)}</span>
                </span>
                <span className="sp-event-files">{f.files.join(" · ")}</span>
              </li>
            ))}
          </ul>}
          <blockquote className="sp-event-quote">{message.text}</blockquote>
        </>
      ) : e.questions?.length ? (
        <ul className="sp-event-quote">
          {e.questions.map((q, i) => (
            <li key={i}>
              {q.question}
              <span className="sp-event-options">{q.options.length ? q.options.join(" · ") : "Open question: answered by typing"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <blockquote className="sp-event-quote">{message.text}</blockquote>
      )}
      {e.byModel && <p className="sp-event-note">Rails' rules didn't catch this; its decision model did.</p>}
      {e.quiet && <p className="sp-event-note">{name} looked: {e.what === "overlap" ? "they don't clash." : e.what === "handoff" ? "it isn't done yet." : e.what === "finding" ? "nothing for them to do." : "nothing needed from you."}</p>}
    </div>
  );
}
