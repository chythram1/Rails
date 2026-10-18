import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowDown as ArrowDown, IconChevronLeft as ChevronLeft, IconDotsVertical as EllipsisVertical, IconLayoutSidebarRight as PanelRight } from "@tabler/icons-react";
import type { Sprocket as SprocketData, SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../Composer.tsx";
import { MenuButton } from "../Menu.tsx";
import { useStore } from "../../store.tsx";
import { Sprocket } from "./Sprocket.tsx";
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
 * do), and time labels break it up where there are gaps. The user's messages sit on the right, replies on
 * the left, and rails' own notices (no model yet, errors) in the middle. A reply shows as it's written.
 */
export function SprocketChat({ sprocket, panelOpen }: { sprocket: SprocketData; panelOpen: boolean }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const project = projects.find((p) => p.id === sprocket.projectId);
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
  /** The reply being revealed (revealText.tsx): while it's written, then as the saved message `id`. */
  const [reveal, setReveal] = useState<{ text: string; live: boolean; id?: string } | null>(null);
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
  const scroll = useThreadScroll(thread, spacer, sprocket.running, [messages, reveal?.id, shown, sprocket.running]);

  const load = useCallback(async () => {
    try {
      const list = await api.sprocketMessages(id);
      // A reply that wasn't here before (it just finished, or arrived whole) is revealed, carrying on
      // from where the written-out text got to.
      const known = seen.current;
      seen.current = new Set(list.map((m) => m.id));
      const reply = known ? list.filter((m) => m.author === "sprocket" && !known.has(m.id)).at(-1) : undefined;
      if (reply) setReveal({ text: reply.text, live: false, id: reply.id });
      setMessages(list);
      setLoadError("");
    } catch (e: any) {
      setLoadError(e.message);
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
    });
  }, [load, id]);

  // A new run (possibly started on another device) starts with "Thinking…", not the last reply.
  useEffect(() => {
    if (sprocket.running) setReveal((r) => (r?.id ? null : r));
  }, [sprocket.running]);

  const send = async (text: string) => {
    setError("");
    setReveal(null);
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

  const remove = async () => {
    if (!confirm(`Delete ${name}? Its chat is deleted too.`)) return;
    try {
      await api.deleteSprocket(id);
      navigate(href.sprockets());
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <section className="sp-chat" aria-labelledby="sp-chat-title">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.sprockets()} aria-label="All Sprockets">
          <ChevronLeft size={18} />
        </a>
        <Sprocket look={sprocket.look} size={28} seed={id} />
        <h2 id="sp-chat-title" className="truncate" title={name}>{name}</h2>
        {project && <span className="sp-project truncate" title={`Attached to ${project.name}`}>{project.name}</span>}
        <span className="grow" />
        <a
          className={"icon-btn" + (panelOpen ? " active" : "")}
          href={panelOpen ? href.sprocket(id) : href.sprocketSettings(id)}
          aria-label={`${name} settings`}
          aria-expanded={panelOpen}
          title={panelOpen ? "Close settings" : "Settings"}
        >
          <PanelRight size={18} />
        </a>
        <MenuButton
          label={`${name} actions`}
          title="More"
          icon={<EllipsisVertical size={16} />}
          align="right"
          items={[
            { label: "Settings", shortcut: "s", onSelect: () => navigate(panelOpen ? href.sprocket(id) : href.sprocketSettings(id)) },
            { label: "Change look", shortcut: "l", onSelect: () => navigate(href.editSprocket(id)) },
            { label: "Delete", shortcut: "d", danger: true, onSelect: () => void remove() },
          ]}
        />
      </header>
      <div className="sp-thread" ref={thread}>
        {loadError && !messages && (
          <div className="sp-placeholder">
            <p className="error" role="alert">{loadError}</p>
            <button className="btn" onClick={() => void load()}>Try again</button>
          </div>
        )}
        {messages && (
          <div className={"sp-intro" + (messages.length ? "" : " alone")}>
            <Sprocket look={sprocket.look} size={messages.length ? 88 : 120} seed={id} />
            <p className="sp-intro-title">{messages.length ? name : `Say hello to ${name}`}</p>
            <p className="muted small">
              {messages.length
                ? `This is the beginning of your chat with ${name}${project ? ` in ${project.name}` : ""}.`
                : project
                  ? `${name} is attached to ${project.name}.`
                  : `${name} isn't attached to a project. You can attach it in Settings.`}
            </p>
          </div>
        )}
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
                  {m.author !== "notice" && <MessageActions text={m.text} at={m.createdAt} now={now} reply={m.author === "sprocket"} />}
                </li>
              );
            })}
            {sprocket.running && !reveal?.id && (
              <li className="sp-message sprocket" aria-hidden>
                {/* "Thinking…" holds its place until the first words show, so the row never empties. */}
                {reveal && shown > 0 ? (
                  <p className="sp-bubble">
                    <Revealed text={reveal.text} shown={shown} fresh={fresh} />
                  </p>
                ) : (
                  <p className="sp-thinking">
                    <Sprocket look={sprocket.look} size={22} seed={id} /> Thinking…
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
        <Composer placeholder={`Message ${name}`} onSubmit={(text) => void send(text)} autoFocus compact />
      </div>
    </section>
  );
}
