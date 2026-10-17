import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, EllipsisVertical } from "lucide-react";
import type { Sprocket as SprocketData, SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../Composer.tsx";
import { MenuButton } from "../Menu.tsx";
import { Sprocket } from "./Sprocket.tsx";

/**
 * A Sprocket's chat. Stage 1 (ADR 0005): messages are stored and shown, but nothing answers them yet, so
 * the thread says so after the last one.
 */
export function SprocketChat({ sprocket }: { sprocket: SprocketData }) {
  const { id, name } = sprocket;
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
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
    });
  }, [load]);

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  const send = async (text: string) => {
    setError("");
    const pending: SprocketMessage = { id: "pending", sprocketId: id, text, createdAt: new Date().toISOString() };
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
        <h2 id="sp-chat-title" className="truncate">{name}</h2>
        <span className="grow" />
        <MenuButton
          label={`${name} actions`}
          title="More"
          icon={<EllipsisVertical size={16} />}
          align="right"
          items={[
            { label: "Edit", shortcut: "e", onSelect: () => navigate(href.editSprocket(id)) },
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
        {messages?.length === 0 && (
          <div className="sp-empty">
            <Sprocket look={sprocket.look} size={120} seed={id} />
            <p className="sp-empty-title">Say hello to {name}</p>
            <p className="muted small">{name} can't reply yet. Chatting with Sprockets is coming in a later update.</p>
          </div>
        )}
        {!!messages?.length && (
          <ol className="sp-messages" aria-label={`Messages to ${name}`}>
            {messages.map((m, i) => (
              <li key={m.id + i} className="sp-bubble" title={new Date(m.createdAt).toLocaleString()}>
                {m.text}
              </li>
            ))}
          </ol>
        )}
        {/* Always rendered, so screen readers announce the notice when the first message appears. */}
        <p className="sp-notice" role="status">
          {messages?.length ? `${name} can't reply yet.` : ""}
        </p>
      </div>
      <div className="sp-compose">
        {error && <p className="error" role="alert">{error}</p>}
        <Composer placeholder={`Message ${name}`} onSubmit={(text) => void send(text)} autoFocus />
      </div>
    </section>
  );
}
