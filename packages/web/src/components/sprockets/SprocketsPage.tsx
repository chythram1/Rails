import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import type { Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { timeAgo } from "../../util.ts";
import { socket } from "../../ws.ts";
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
    main = <SprocketCreator key="new" taken={list.map((s) => s.name)} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={list.length ? () => navigate(href.sprockets()) : undefined} />;
  } else if (route.view === "edit" && current) {
    main = <SprocketCreator key={current.id} sprocket={current} taken={[]} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={() => navigate(href.sprocket(current.id))} />;
  } else if (route.view === "chat" && current) {
    main = <SprocketChat key={current.id} sprocket={current} />;
  } else if (route.id) {
    main = <p className="sp-placeholder muted">This one doesn't exist anymore. It may have been deleted on another device.</p>;
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

/** The list column. Its header is a search field (as in Telegram, Lindy or ref chat.png) rather than a title. */
function SprocketList({ list, activeId }: { list: SprocketData[]; activeId?: string }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((s) => s.name.toLowerCase().includes(q) || s.lastMessage?.text.toLowerCase().includes(q)) : list;
  }, [list, query]);
  return (
    <aside className="sp-list" aria-labelledby="sp-list-title">
      <h1 id="sp-list-title" className="sr-only">Sprockets</h1>
      <div className="sp-list-head">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search Sprockets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <a className="icon-btn" href={href.newSprocket()} aria-label="New Sprocket" title="New Sprocket">
          <Plus size={18} />
        </a>
      </div>
      {list.length === 0 ? (
        <p className="muted small pad">Your first one will show up here.</p>
      ) : shown.length === 0 ? (
        <p className="muted small pad">No matches</p>
      ) : (
        <ul className="sp-rows">
          {shown.map((s) => (
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
      <h2 className="sr-only">All Sprockets</h2>
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
            <span className="sp-card-name">New</span>
          </a>
        </li>
      </ul>
    </div>
  );
}
