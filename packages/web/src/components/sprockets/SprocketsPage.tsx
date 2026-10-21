import { Fragment, useMemo, useState } from "react";
import { IconChevronDown as ChevronDown, IconFilter as Filter, IconFolder as Folder, IconPlus as Plus, IconSearch as Search } from "@tabler/icons-react";
import type { Project, Sprocket as SprocketData, SprocketChatInfo } from "@rails/shared";
import { href, navigate, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { timeAgo } from "../../util.ts";
import { MenuButton } from "../Menu.tsx";
import { Sprocket, VIEW } from "./Sprocket.tsx";
import { SprocketChat } from "./SprocketChat.tsx";
import { SprocketCreator } from "./SprocketCreator.tsx";
import { SprocketSettings } from "./SprocketSettings.tsx";
import { groupSprockets } from "./groups.ts";
import { useSprockets } from "./useSprockets.ts";

type SprocketsRoute = Extract<Route, { name: "sprockets" }>;

/**
 * Sprockets (ADR 0005): a list of the user's Sprockets beside the selected chat, or the creator. A Sprocket's own chat
 * opens from its row; an attached one's project chat (ADR 0021) from the row above it, under the project's heading.
 * On small screens only one of the two shows at a time.
 */
export function SprocketsPage({ route }: { route: SprocketsRoute }) {
  const { list, error } = useSprockets();
  const { projects } = useStore();
  /** Which group the list shows: all, a project's id, or "general" (unattached). */
  const [filter, setFilter] = useState("all");

  if (!list) return error ? <p className="error pad" role="alert">{error}</p> : null;
  // A filter for a group that's gone (its last Sprocket moved or was deleted) shows everything again.
  const shownFilter = filter === "all" || groupSprockets(list, projects).some((g) => g.key === filter) ? filter : "all";

  const current = route.id ? list.find((s) => s.id === route.id) : undefined;
  const creating = route.view === "new" || (route.view === "list" && list.length === 0);
  let main;
  if (creating) {
    main = <SprocketCreator key="new" taken={list.map((s) => s.name)} onSaved={(s) => navigate(href.sprocket(s.id))} onCancel={list.length ? () => navigate(href.sprockets()) : undefined} />;
  } else if ((route.view === "chat" || route.view === "settings") && current) {
    // The chat stays put while its settings panel opens and closes beside it. The key is on the wrapper:
    // another Sprocket gets a fresh chat and panel (siblings sharing one key would pile up old chats).
    const panel = route.view === "settings";
    // A project chat that's gone (the Sprocket was detached, maybe on another device) falls back to its own chat.
    const onProject = !!route.project && !!current.projectChat;
    const chat = onProject ? current.projectChat! : current.direct;
    main = (
      <div key={chat.id} className="sp-detail">
        <SprocketChat sprocket={current} chat={chat} panelOpen={panel} />
        {panel && <SprocketSettings sprocket={current} all={list} onProjectChat={onProject} />}
      </div>
    );
  } else if (route.id) {
    main = <p className="sp-placeholder muted">This one doesn't exist anymore. It may have been deleted on another device.</p>;
  } else {
    main = <Gallery list={list} />;
  }

  return (
    <div className={"sprockets " + (route.view === "list" && !creating ? "at-list" : "at-detail")}>
      <SprocketList list={list} projects={projects} filter={shownFilter} onFilter={setFilter} activeId={route.id} activeProject={!!route.project} />
      <section className="sp-main">{main}</section>
    </div>
  );
}

/**
 * The list column. Its header is a search field; under it, always there so
 * nothing shifts when a group appears, a filter menu named after what it shows: All Sprockets, each project with
 * Sprockets, General. Rows are grouped by project under small headings. New Sprockets are made from the gallery
 * (and, on phones, a row at the end of the list).
 */
function SprocketList(props: { list: SprocketData[]; projects: Project[]; filter: string; onFilter(key: string): void; activeId?: string; activeProject: boolean }) {
  const { list, projects, filter, onFilter, activeId, activeProject } = props;
  const [query, setQuery] = useState("");
  const all = useMemo(() => groupSprockets(list, projects), [list, projects]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const said = (c?: SprocketChatInfo) => !!c?.lastMessage?.text.toLowerCase().includes(q);
    const projectName = (s: SprocketData) => projects.find((p) => p.id === s.projectId)?.name.toLowerCase() ?? "";
    const match = (s: SprocketData) => !q || s.name.toLowerCase().includes(q) || projectName(s).includes(q) || said(s.direct) || said(s.projectChat);
    return groupSprockets(list.filter(match), projects, filter);
  }, [list, projects, filter, query]);
  const shownName = filter === "all" ? "All Sprockets" : all.find((g) => g.key === filter)?.title;
  return (
    <aside className="sp-list" aria-labelledby="sp-list-title">
      <h1 id="sp-list-title" className="sr-only">Sprockets</h1>
      <div className="sp-list-head">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search Sprockets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="sp-filter">
        <MenuButton
          plain
          label={`Show: ${shownName}`}
          title="Filter by project"
          className={"sp-filter-btn" + (filter === "all" ? "" : " on")}
          icon={
            <>
              <Filter size={14} aria-hidden />
              <span className="truncate">{shownName}</span>
              <ChevronDown size={14} aria-hidden />
            </>
          }
          items={[
            { label: "All Sprockets", checked: filter === "all", onSelect: () => onFilter("all") },
            ...(all.length ? ["separator" as const] : []),
            ...all.map((g) => ({ label: g.title, checked: filter === g.key, onSelect: () => onFilter(g.key) })),
          ]}
        />
      </div>
      {list.length === 0 ? (
        <p className="muted small pad">Your first one will show up here.</p>
      ) : groups.length === 0 ? (
        <p className="muted small pad">No matches</p>
      ) : (
        <div className="sp-groups">
          {groups.map((g) => (
            <section key={g.key} className="sp-group" aria-labelledby={`sp-group-${g.key}`}>
              <h2 id={`sp-group-${g.key}`} className="sp-group-title truncate" title={g.title}>{g.title}</h2>
              <ul className="sp-rows">
                {g.list.map((s) => (
                  <Fragment key={s.id}>
                    {s.projectChat && (
                      <li>
                        <ProjectChatRow sprocket={s} chat={s.projectChat} project={g.title} active={s.id === activeId && activeProject} />
                      </li>
                    )}
                    <li>
                      <SprocketRow sprocket={s} active={s.id === activeId && !(activeProject && s.projectChat)} />
                    </li>
                  </Fragment>
                ))}
              </ul>
            </section>
          ))}
          <a className="sp-row sp-new-row" href={href.newSprocket()}>
            <span className="sp-new-icon" aria-hidden>
              <Plus size={18} />
            </span>
            New Sprocket
          </a>
        </div>
      )}
    </aside>
  );
}

/** A Sprocket's own chat in the list, by its character and name. */
function SprocketRow({ sprocket: s, active }: { sprocket: SprocketData; active: boolean }) {
  return (
    <a className="sp-row" href={href.sprocket(s.id)} title={s.name} aria-current={active ? "page" : undefined}>
      <Sprocket look={s.look} size={36} seed={s.id} />
      <RowText name={s.name} chat={s.direct} />
    </a>
  );
}

/** A project's chat (ADR 0021), above its Sprocket's row: the project's folder and name, then the chat's last line. */
function ProjectChatRow({ sprocket: s, chat, project, active }: { sprocket: SprocketData; chat: SprocketChatInfo; project: string; active: boolean }) {
  return (
    <a className="sp-row" href={href.sprocket(s.id, true)} title={`${project}'s chat with ${s.name}`} aria-current={active ? "page" : undefined}>
      <span className="sp-chat-icon" aria-hidden>
        <Folder size={18} />
      </span>
      <RowText name={project} chat={chat} />
    </a>
  );
}

/** A chat's name, when it was last active (nothing while it's empty, as after Clear), its last line and a dot while a reply waits. */
function RowText({ name, chat }: { name: string; chat: SprocketChatInfo }) {
  return (
    <span className="sp-row-text">
      <span className="sp-row-top">
        <span className="sp-row-name truncate">{name}</span>
        {chat.lastMessage && <span className="muted small session-time">{timeAgo(chat.lastMessage.createdAt)}</span>}
      </span>
      <span className="sp-row-bottom">
        <span className="muted small truncate">{preview(chat)}</span>
        {chat.pending > 0 && <span className="tab-attention" role="img" aria-label={chat.pending > 1 ? `${chat.pending} replies ready` : "A reply is ready"} />}
      </span>
    </span>
  );
}

/**
 * The page with no Sprocket open (desktop): every Sprocket as a card with its character idling, like a
 * cast line-up, and a card that makes a new one. One grid in the
 * order they were made, so cards never move around; the list beside it groups them by project.
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
              <span className="muted small truncate">{preview(s.direct)}</span>
            </a>
          </li>
        ))}
        <li>
          <a className="sp-card sp-card-new" href={href.newSprocket()}>
            <NewArt />
            <span className="sp-card-name">New Sprocket</span>
            <span className="muted small truncate">Pick a look and a name</span>
          </a>
        </li>
      </ul>
    </div>
  );
}

/**
 * The New card's picture, in a character's frame (the same box and ground shadow, Sprocket.tsx), so its name lines
 * up with theirs: a round-ended plus standing where a body would.
 */
function NewArt() {
  return (
    <svg className="sprocket sp-new-art" viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} style={{ width: 84, height: (84 * VIEW.h) / VIEW.w }} aria-hidden>
      <ellipse className="s-shadow" cx={100} cy={203} rx={44} ry={6} />
      <g className="sp-new-plus">
        <rect x={94} y={106} width={12} height={74} rx={6} />
        <rect x={63} y={137} width={74} height={12} rx={6} />
      </g>
    </svg>
  );
}

/** The list's one-line preview of a chat. */
function preview(chat: SprocketChatInfo): string {
  if (chat.running) return "Replying…";
  const m = chat.lastMessage;
  if (!m) return "No messages yet";
  if (m.event) return `${m.event.title}: ${m.event.questions?.[0]?.question ?? m.text}`;
  return m.author === "user" ? `You: ${m.text}` : m.text;
}
