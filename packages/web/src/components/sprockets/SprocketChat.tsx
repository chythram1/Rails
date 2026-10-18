import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconDotsVertical as EllipsisVertical } from "@tabler/icons-react";
import type { Sprocket as SprocketData, SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../Composer.tsx";
import { MenuButton } from "../Menu.tsx";
import { useStore } from "../../store.tsx";
import { Sprocket } from "./Sprocket.tsx";

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
export function SprocketChat({ sprocket }: { sprocket: SprocketData }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const project = projects.find((p) => p.id === sprocket.projectId);
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const thread = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await api.sprocketMessages(id));
      setLoadError("");
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
      if (m.type === "sprockets.typing" && m.sprocketId === id) setTyping(m.text);
    });
  }, [load, id]);

  // Keep the newest message (or the reply being written) in view.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, typing, sprocket.running]);

  const send = async (text: string) => {
    setError("");
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
        <MenuButton
          label={`${name} actions`}
          title="More"
          icon={<EllipsisVertical size={16} />}
          align="right"
          items={[
            { label: "Settings", shortcut: "s", onSelect: () => navigate(href.sprocketSettings(id)) },
            { label: "Edit look", shortcut: "e", onSelect: () => navigate(href.editSprocket(id)) },
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
          // A log: screen readers announce new messages (not the reply while it's being written).
          <ol className="sp-messages" aria-label={`Chat with ${name}`} role="log">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const label = !prev || newGroup(prev.createdAt, m.createdAt);
              return (
                <li key={m.id + i} className={"sp-message " + m.author}>
                  {label && <time className="sp-stamp" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>}
                  <p className="sp-bubble" title={new Date(m.createdAt).toLocaleString()}>
                    {m.author === "sprocket" && <span className="sr-only">{name}: </span>}
                    {m.text}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        {sprocket.running && (
          <div className="sp-message sprocket" aria-hidden>
            {typing ? (
              <p className="sp-bubble">{typing}</p>
            ) : (
              <p className="sp-thinking">
                <Sprocket look={sprocket.look} size={22} seed={id} /> Thinking…
              </p>
            )}
          </div>
        )}
        <p className="sr-only" role="status">{sprocket.running ? `${name} is replying` : ""}</p>
      </div>
      <div className="sp-compose">
        {error && <p className="error" role="alert">{error}</p>}
        <Composer placeholder={`Message ${name}`} onSubmit={(text) => void send(text)} autoFocus compact />
      </div>
    </section>
  );
}
