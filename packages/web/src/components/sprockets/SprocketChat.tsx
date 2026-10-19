import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowDown as ArrowDown, IconChevronLeft as ChevronLeft } from "@tabler/icons-react";
import type { Sprocket as SprocketData, SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../Composer.tsx";
import { useStore } from "../../store.tsx";
import { Sprocket } from "./Sprocket.tsx";
import { PanelToggle } from "./SprocketSettings.tsx";
import { EventRow } from "./EventRow.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { Revealed, useRevealedText } from "./revealText.tsx";
import { useThreadScroll } from "./threadScroll.ts";

/** A new time label when a message comes over an hour after the previous one (or on a new day). */
const GAP_MS = 60 * 60 * 1000;

const newGroup = (prev: string, next: string) =>
  new Date(next).getTime() - new Date(prev).getTime() > GAP_MS || new Date(prev).toDateString() !== new Date(next).toDateString();

/** "Today 9:04 AM", "Yesterday 3:10 PM" or "Oct 3, 9:04 AM". */
function stamp(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * A Sprocket's chat (ADR 0005, 0006). The thread opens with the Sprocket itself (as Dot, Pi and hilos
 * do; once there are messages, one quiet line), and time labels break it up where there are gaps. The user's messages sit on the right, replies on
 * the left, and rails' own notices (no model yet, errors) in the middle. A Coordinator's chat also has the
 * sessions that waited for the user (EventRow). A reply shows as it's written. `embedded` is the chat in a
 * workspace's side panel (SidePanel.tsx), which has a header of its own.
 */
export function SprocketChat({ sprocket, panelOpen, embedded = false }: { sprocket: SprocketData; panelOpen: boolean; embedded?: boolean }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const project = projects.find((p) => p.id === sprocket.projectId);
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
  /** The reply being revealed (revealText.tsx): while it's written, then as the saved message `id`. */
  const [reveal, setReveal] = useState<{ text: string; live: boolean; id?: string } | null>(null);
  /** The reply's run log while it's written: the step it's on, and what it has done so far. */
  const [activity, setActivity] = useState<{ step: string | null; summary: string | null }>({ step: null, summary: null });
  /** Messages already shown; null until the first load, whose messages show at once. */
  const seen = useRef<Set<string> | null>(null);
  /** Re-renders once a minute, so "5 minutes ago" under each message stays true. */
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const { shown, fresh } = useRevealedText(reveal?.text ?? "", reveal?.live === true);
  const scroll = useThreadScroll(thread, spacer, sprocket.running, [messages, reveal?.id, shown, sprocket.running, activity.summary]);

  /** Loads overlap (the first one, every `sprockets.changed`, StrictMode's second run): only the latest applies. */
  const loads = useRef(0);
  const load = useCallback(async () => {
    const n = ++loads.current;
    try {
      const list = await api.sprocketMessages(id);
      if (n !== loads.current) return; // a newer load is on its way, and an older answer would undo it
      // A reply that wasn't here before (it just finished, or arrived whole) is revealed, carrying on
      // from where the written-out text got to.
      const known = seen.current;
      seen.current = new Set(list.map((m) => m.id));
      const reply = known ? list.filter((m) => m.author === "sprocket" && !known.has(m.id)).at(-1) : undefined;
      if (reply) setReveal({ text: reply.text, live: false, id: reply.id });
      setMessages(list);
      setLoadError("");
    } catch (e: any) {
      if (n === loads.current) setLoadError(e.message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
      if (m.type === "sprockets.typing" && m.sprocketId === id) {
        const text = m.text;
        setReveal((r) => (text === null ? r && { ...r, live: false } : { text, live: true }));
      }
      // The summary outlives the run's end by a moment (until the saved reply, which carries it, loads), so
      // it doesn't blink out; a new send or run clears it.
      if (m.type === "sprockets.activity" && m.sprocketId === id) setActivity((a) => ({ step: m.step, summary: m.summary ?? a.summary }));
    });
  }, [load, id]);

  // A new run (possibly started on another device) starts with "Thinking…", not the last reply.
  useEffect(() => {
    if (sprocket.running) setReveal((r) => (r?.id ? null : r));
    if (sprocket.running) setActivity((a) => (reveal?.id ? { step: null, summary: null } : a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprocket.running]);

  const send = async (text: string) => {
    setError("");
    setReveal(null);
    setActivity({ step: null, summary: null });
    scroll.onSend();
    const pending: SprocketMessage = { id: "pending", sprocketId: id, author: "user", text, createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), pending]);
    try {
      await api.sendSprocketMessage(id, text);
    } catch (e: any) {
      setError(e.message);
    }
    await load();
  };


  return (
    <section className="sp-chat" {...(embedded ? { "aria-label": `Chat with ${name}` } : { "aria-labelledby": "sp-chat-title" })}>
      {!embedded && (
        <header className="sp-head">
          <a className="icon-btn sp-back" href={href.sprockets()} aria-label="All Sprockets">
            <ChevronLeft size={18} />
          </a>
          <Sprocket look={sprocket.look} size={28} seed={id} />
          <h2 id="sp-chat-title" className="truncate" title={name}>{name}</h2>
          <span className="grow" />
          {/* While the settings panel is open, its toggle sits at the panel's top right instead. */}
          {!panelOpen && <PanelToggle sprocket={sprocket} open={false} />}
        </header>
      )}
      <div className="sp-thread" ref={thread}>
        {loadError && !messages && (
          <div className="sp-placeholder">
            <p className="error" role="alert">{loadError}</p>
            <button className="btn" onClick={() => void load()}>Try again</button>
          </div>
        )}
        {/* The character greets an empty chat; once it has messages, one quiet line marks where it starts. */}
        {messages &&
          (messages.length ? (
            <p className="sp-intro-line muted small">This is the beginning of your chat with {name}{project ? ` in ${project.name}` : ""}.</p>
          ) : (
            <div className="sp-intro alone">
              <Sprocket look={sprocket.look} size={120} seed={id} />
              <p className="sp-intro-title">Say hello to {name}</p>
              <p className="muted small">{project ? `${name} is attached to ${project.name}.` : `${name} isn't attached to a project. You can attach it in Settings.`}</p>
            </div>
          ))}
        {!!messages?.length && (
          // A log: screen readers announce new messages (not the reply while it's being written, which sits
          // in the list, where the reply will be, but hidden from them).
          <ol className="sp-messages" aria-label={`Chat with ${name}`} role="log">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const label = !prev || newGroup(prev.createdAt, m.createdAt);
              return (
                <li key={m.id + i} className={"sp-message " + m.author}>
                  {label && <time className="sp-stamp" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>}
                  {m.activity && <p className="sp-steps">{m.activity}</p>}
                  {m.event ? (
                    <EventRow message={m} projectId={sprocket.projectId} name={name} />
                  ) : (
                    <p className="sp-bubble">
                      {m.author === "sprocket" && <span className="sr-only">{name}: </span>}
                      {m.id === reveal?.id ? (
                        <>
                          {/* Screen readers get the whole reply once, not every revealed piece. */}
                          <span className="sr-only">{m.text}</span>
                          <span aria-hidden>
                            <Revealed text={m.text} shown={shown} fresh={fresh} />
                          </span>
                        </>
                      ) : (
                        m.text
                      )}
                    </p>
                  )}
                  {/* A Coordinator's suggested replies, once its message has been revealed. */}
                  {!!m.suggestions?.length &&
                    !(m.id === reveal?.id && shown < m.text.length) &&
                    m.suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} projectId={sprocket.projectId} />)}
                  {m.author !== "notice" && <MessageActions text={m.text} at={m.createdAt} now={now} reply={m.author !== "user"} />}
                </li>
              );
            })}
            {sprocket.running && !reveal?.id && (
              <li className="sp-message sprocket" aria-hidden>
                {/* The same line the saved reply will carry, so nothing moves when it replaces this. */}
                {activity.summary && <p className="sp-steps">{activity.summary}</p>}
                {/* "Thinking…" (or the step it's on) holds its place until the first words show, so the row never empties. */}
                {reveal && shown > 0 ? (
                  <p className="sp-bubble">
                    <Revealed text={reveal.text} shown={shown} fresh={fresh} />
                  </p>
                ) : (
                  <p className="sp-thinking">
                    {activity.step ? `${activity.step}…` : "Thinking…"}
                  </p>
                )}
              </li>
            )}
          </ol>
        )}
        <div className="sp-spacer" ref={spacer} aria-hidden />
        <div className="sp-fade" aria-hidden />
        <p className="sr-only" role="status">{sprocket.running ? `${name} is replying` : ""}</p>
      </div>
      <div className="sp-compose">
        {scroll.hidden && (
          <button className="sp-jump" aria-label="Jump to the latest message" title="Jump to latest" onClick={scroll.jumpToLatest}>
            <ArrowDown size={16} />
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <Composer placeholder={`Message ${name}`} onSubmit={(text) => void send(text)} autoFocus={!embedded} compact />
      </div>
    </section>
  );
}
