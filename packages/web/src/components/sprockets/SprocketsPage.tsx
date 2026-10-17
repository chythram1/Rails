import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Plus } from "lucide-react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { timeAgo } from "../../util.ts";
import { socket } from "../../ws.ts";
import { setSprocketMotion, useSprocketMotion } from "./motion.ts";
import { Sprocket } from "./Sprocket.tsx";
import { SprocketChat } from "./SprocketChat.tsx";
import { SprocketCreator } from "./SprocketCreator.tsx";

type SprocketsRoute = Extract<Route, { name: "sprockets" }>;

/**
 * Sprockets (ADR 0005): a list of the user's Sprockets beside the selected one's chat, or the creator.
 * On small screens only one of the two shows at a time.
 */
export function SprocketsPage({ route }: { route: SprocketsRoute }) {
  const [list, setList] = useState<SprocketData[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setList(await api.sprockets());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
    });
  }, [load]);

  if (!list) return error ? <p className="error pad" role="alert">{error}</p> : null;

  const current = route.id ? list.find((s) => s.id === route.id) : undefined;
  const creating = route.view === "new" || (route.view === "list" && list.length === 0);
  let main;
  if (creating) {
    main = <SprocketCreator key="new" onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={list.length ? () => navigate(href.sprockets()) : undefined} />;
  } else if (route.view === "edit" && current) {
    main = <SprocketCreator key={current.id} sprocket={current} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={() => navigate(href.sprocket(current.id))} />;
  } else if (route.view === "chat" && current) {
    main = <SprocketChat key={current.id} sprocket={current} />;
  } else if (route.id) {
    main = <p className="sp-placeholder muted">This Sprocket doesn't exist anymore.</p>;
  } else {
    main = <Gallery list={list} />;
  }

  return (
    <div className={"sprockets " + (route.view === "list" && !creating ? "at-list" : "at-detail")}>
      <SprocketList list={list} activeId={route.id} />
      <section className="sp-main">{main}</section>
    </div>
  );
}

function SprocketList({ list, activeId }: { list: SprocketData[]; activeId?: string }) {
  const motion = useSprocketMotion();
  return (
    <aside className="sp-list" aria-labelledby="sp-list-title">
      <div className="sp-list-head">
        <h1 id="sp-list-title" className="sp-list-title">Sprockets</h1>
        {/* Idle animations loop forever, so they get a visible pause control (WCAG 2.2.2). */}
        <button className="icon-btn" aria-label={motion ? "Pause animations" : "Play animations"} title={motion ? "Pause animations" : "Play animations"} onClick={() => setSprocketMotion(!motion)}>
          {motion ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <a className="icon-btn" href={href.newSprocket()} aria-label="New Sprocket" title="New Sprocket">
          <Plus size={18} />
        </a>
      </div>
      {list.length === 0 ? (
        <p className="muted small pad">No Sprockets yet.</p>
      ) : (
        <ul className="sp-rows">
          {list.map((s) => (
            <li key={s.id}>
              <a className="sp-row" href={href.sprocket(s.id)} title={s.name} aria-current={s.id === activeId ? "page" : undefined}>
                <Sprocket look={s.look} size={36} seed={s.id} />
                <span className="sp-row-text">
                  <span className="sp-row-top">
                    <span className="truncate">{s.name}</span>
                    <span className="muted small session-time">{timeAgo(s.lastMessage?.createdAt ?? s.createdAt)}</span>
                  </span>
                  <span className="muted small truncate">{s.lastMessage?.text ?? "No messages yet"}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/**
 * The page with no Sprocket open (desktop): every Sprocket as a card with its character idling, like a
 * cast line-up (ref core-characters.png, Grok's companions), plus a card that makes a new one.
 */
function Gallery({ list }: { list: SprocketData[] }) {
  return (
    <div className="sp-gallery">
      <header className="sp-gallery-head">
        <h2>Your Sprockets</h2>
        <p className="muted small">Pick one to chat with, or make a new one.</p>
      </header>
      <ul className="sp-cards">
        {list.map((s) => (
          <li key={s.id}>
            <a className="sp-card" href={href.sprocket(s.id)} title={s.name}>
              <Sprocket look={s.look} size={84} seed={s.id} />
              <span className="sp-card-name truncate">{s.name}</span>
              <span className="muted small truncate">{s.lastMessage?.text ?? "No messages yet"}</span>
            </a>
          </li>
        ))}
        <li>
          <a className="sp-card sp-card-new" href={href.newSprocket()}>
            <span className="sp-card-plus" aria-hidden>
              <Plus size={28} />
            </span>
            <span className="sp-card-name">New Sprocket</span>
          </a>
        </li>
      </ul>
    </div>
  );
}
