import { useMemo, useState } from "react";
import { IconPlus as Plus, IconSearch as Search } from "@tabler/icons-react";
import type { Project, Sprocket as SprocketData } from "@rails/shared";
import { href, navigate, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { timeAgo } from "../../util.ts";
import { Sprocket } from "./Sprocket.tsx";
import { SprocketChat } from "./SprocketChat.tsx";
import { SprocketCreator } from "./SprocketCreator.tsx";
import { SprocketSettings } from "./SprocketSettings.tsx";
import { GENERAL, groupSprockets, lastActive, type Group } from "./groups.ts";
import { useSprockets } from "./useSprockets.ts";

type SprocketsRoute = Extract<Route, { name: "sprockets" }>;

/**
 * Sprockets (ADR 0005): a list of the user's Sprockets beside the selected one's chat, or the creator.
 * On small screens only one of the two shows at a time.
 */
export function SprocketsPage({ route }: { route: SprocketsRoute }) {
  const { list, error } = useSprockets();
  const { projects } = useStore();
  /** Which group the list (and the gallery) shows: all, a project's id, or "general" (unattached). */
  const [filter, setFilter] = useState("all");

  if (!list) return error ? <p className="error pad" role="alert">{error}</p> : null;
  // A filter for a group that's gone (its last Sprocket moved or was deleted) shows everything again.
  const shownFilter = filter === "all" || groupSprockets(list, projects).some((g) => g.key === filter) ? filter : "all";

  const current = route.id ? list.find((s) => s.id === route.id) : undefined;
  const creating = route.view === "new" || (route.view === "list" && list.length === 0);
  let main;
  if (creating) {
    main = <SprocketCreator key="new" taken={list.map((s) => s.name)} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={list.length ? () => navigate(href.sprockets()) : undefined} />;
  } else if (route.view === "edit" && current) {
    main = <SprocketCreator key={current.id} sprocket={current} taken={[]} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={() => navigate(href.sprocket(current.id))} />;
  } else if ((route.view === "chat" || route.view === "settings") && current) {
    // The chat stays put while its settings panel opens and closes beside it. The key is on the wrapper:
    // another Sprocket gets a fresh chat and panel (siblings sharing one key would pile up old chats).
    const panel = route.view === "settings";
    main = (
      <div key={current.id} className="sp-detail">
        <SprocketChat sprocket={current} panelOpen={panel} />
        {panel && <SprocketSettings sprocket={current} all={list} />}
      </div>
    );
  } else if (route.id) {
    main = <p className="sp-placeholder muted">This one doesn't exist anymore. It may have been deleted on another device.</p>;
  } else {
    main = <Gallery groups={groupSprockets(list, projects, shownFilter)} />;
  }

  return (
    <div className={"sprockets " + (route.view === "list" && !creating ? "at-list" : "at-detail")}>
      <SprocketList list={list} projects={projects} filter={shownFilter} onFilter={setFilter} activeId={route.id} />
      <section className="sp-main">{main}</section>
    </div>
  );
}

/**
 * The list column. Its header is a search field (as in Telegram, Lindy or ref chat.png) rather than a title;
 * under it, filter tabs like Telegram's chat folders: All, each project with Sprockets, General. Rows are
 * grouped by project with a small heading.
 */
function SprocketList(props: { list: SprocketData[]; projects: Project[]; filter: string; onFilter(key: string): void; activeId?: string }) {
  const { list, projects, activeId } = props;
  const [query, setQuery] = useState("");
  const tabs = useMemo(() => groupSprockets(list, projects), [list, projects]);
  const { filter } = props;
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: SprocketData) => !q || s.name.toLowerCase().includes(q) || !!s.lastMessage?.text.toLowerCase().includes(q);
    return groupSprockets(list.filter(match), projects, filter);
  }, [list, projects, filter, query]);
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
      {/* Only worth showing when there's more than one group to choose from. */}
      {tabs.length > 1 && (
        <div className="sp-filters" role="group" aria-label="Show">
          {[{ key: "all", title: "All" }, ...tabs].map((t) => (
            <button key={t.key} type="button" className="sp-filter" aria-pressed={filter === t.key} onClick={() => props.onFilter(t.key)} title={t.title}>
              <span className="truncate">{t.title}</span>
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <p className="muted small pad">Your first one will show up here.</p>
      ) : groups.length === 0 ? (
        <p className="muted small pad">No matches</p>
      ) : (
        <div className="sp-groups">
          {groups.map((g) => (
            <section key={g.key} className="sp-group" aria-labelledby={`sp-group-${g.key}`}>
              {/* With one group chosen, its tab already says which: no heading (it stays for screen readers). */}
              <h2 id={`sp-group-${g.key}`} className={filter === "all" ? "sp-group-title truncate" : "sr-only"} title={g.title}>{g.title}</h2>
              <ul className="sp-rows">
                {g.list.map((s) => (
                  <li key={s.id}>
                    <SprocketRow sprocket={s} active={s.id === activeId} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

/** A Sprocket in the list: its name (and role), when it last spoke, its chat's last line, and a dot while a reply waits. */
function SprocketRow({ sprocket: s, active }: { sprocket: SprocketData; active: boolean }) {
  const waiting = s.pending.length;
  return (
    <a className="sp-row" href={href.sprocket(s.id)} title={s.name} aria-current={active ? "page" : undefined}>
      <Sprocket look={s.look} size={36} seed={s.id} />
      <span className="sp-row-text">
        <span className="sp-row-top">
          <span className="sp-row-name truncate">{s.name}</span>
          {s.coordinator && <span className="sp-row-role">Coordinator</span>}
          <span className="muted small session-time">{timeAgo(lastActive(s))}</span>
        </span>
        <span className="sp-row-bottom">
          <span className="muted small truncate">{preview(s)}</span>
          {waiting > 0 && <span className="tab-attention" role="img" aria-label={waiting > 1 ? `${waiting} replies ready` : "A reply is ready"} />}
        </span>
      </span>
    </a>
  );
}

/**
 * The page with no Sprocket open (desktop): every Sprocket as a card with its character idling, like a
 * cast line-up (ref core-characters.png, Grok's companions), grouped like the list. The card that makes a
 * new one is with General, where new Sprockets start, or else after the last group shown.
 */
function Gallery({ groups }: { groups: Group[] }) {
  const withNew = groups.find((g) => g.key === GENERAL) ?? groups.at(-1);
  return (
    <div className="sp-gallery">
      <h2 className="sr-only">All Sprockets</h2>
      {groups.map((g) => (
        <section key={g.key} className="sp-gallery-group" aria-labelledby={`sp-gallery-${g.key}`}>
          <h3 id={`sp-gallery-${g.key}`} className="sp-group-title">{g.title}</h3>
          <ul className="sp-cards">
            {g.list.map((s) => (
              <li key={s.id}>
                <a className="sp-card" href={href.sprocket(s.id)} title={s.name}>
                  <Sprocket look={s.look} size={84} seed={s.id} />
                  <span className="sp-card-name truncate">{s.name}</span>
                  {s.coordinator && <span className="sp-row-role">Coordinator</span>}
                  <span className="muted small truncate">{preview(s)}</span>
                </a>
              </li>
            ))}
            {g === withNew && (
              <li>
                <a className="sp-card sp-card-new" href={href.newSprocket()}>
                  <span className="sp-card-plus" aria-hidden>
                    <Plus size={28} />
                  </span>
                  <span className="sp-card-name">New</span>
                </a>
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The list's one-line preview of a Sprocket's chat. */
function preview(s: SprocketData): string {
  if (s.running) return "Replying…";
  const m = s.lastMessage;
  if (!m) return "No messages yet";
  if (m.event) return `${m.event.title}: ${m.event.questions?.[0]?.question ?? m.text}`;
  return m.author === "user" ? `You: ${m.text}` : m.text;
}
