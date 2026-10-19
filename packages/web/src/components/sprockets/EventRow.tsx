import { sessionKey, type SprocketMessage } from "@rails/shared";
import { href } from "../../router.ts";
import { shortTitle } from "../../util.ts";
import { PanelIcon } from "../PanelMenu.tsx";

/**
 * A session waiting for the user, as Rails puts it in its Coordinator's chat (server watches.ts): which
 * session, what it asked (the dialog's questions, or the end of its last message), and a link to its
 * panel. Or a session that changed files other sessions changed shortly before (overlaps.ts, ADR 0014):
 * which sessions, and the files. The Coordinator's take follows as a normal reply; when it found nothing for
 * the user, a line says so.
 */
export function EventRow({ message, projectId, name }: { message: SprocketMessage; projectId?: string; name: string }) {
  const e = message.event!;
  const open = projectId && (e.kind === "shell" || !e.sessionId ? href.project(projectId) : href.session(projectId, sessionKey(e.kind, e.sessionId)));
  return (
    <div className="sp-event">
      <p className="sp-event-head">
        <PanelIcon kind={e.kind} />
        <span className="sp-event-title truncate" title={e.title}>{shortTitle(e.title)}</span>
        <span className="sp-event-what">{e.what === "overlap" ? "changed the same files as" : e.what === "turn_end" ? "is waiting for your reply" : "is asking you"}</span>
        {open && (
          <a className="sp-event-open" href={open}>
            Open<span className="sr-only"> {e.title}</span>
          </a>
        )}
      </p>
      {e.what === "overlap" ? (
        <ul className="sp-event-quote">
          {e.overlaps?.map((o) => (
            <li key={o.panelId}>
              <span className="sp-event-with">
                <PanelIcon kind={o.kind} />
                <span className="truncate" title={o.title}>{shortTitle(o.title)}</span>
              </span>
              <span className="sp-event-files">{o.files.join(" · ")}</span>
            </li>
          ))}
        </ul>
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
      {e.quiet && <p className="sp-event-note">{name} looked: {e.what === "overlap" ? "they don't clash." : "nothing needed from you."}</p>}
    </div>
  );
}
