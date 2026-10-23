import { useEffect, useMemo, useState } from "react";
import { IconChevronDown as ChevronDown, IconEdit as Compose, IconFilter as Filter, IconPlus as Plus, IconSearch as Search, IconUsersPlus as UsersPlus } from "@tabler/icons-react";
import type { Project, Sprocket as SprocketData, SprocketChatInfo, SprocketTeam } from "@rails/shared";
import { href, navigate, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { timeAgo } from "../../util.ts";
import { MenuButton } from "../Menu.tsx";
import { fetchModelSettings } from "../ModelSelect.tsx";
import { TeamDialog } from "./TeamDialog.tsx";
import { TeamSettings } from "./TeamSettings.tsx";
import { TeamFace } from "./TeamFace.tsx";
import { Sprocket, VIEW } from "./Sprocket.tsx";
import { SprocketChat } from "./SprocketChat.tsx";
import { SprocketCreator } from "./SprocketCreator.tsx";
import { SprocketSettings } from "./SprocketSettings.tsx";
import { groupSprockets } from "./groups.ts";
import { useSprockets } from "./useSprockets.ts";
import { plain } from "./marks.ts";

type SprocketsRoute = Extract<Route, { name: "sprockets" }>;

/**
 * Sprockets (ADR 0005): a list of the user's Sprockets beside the selected chat, or the creator. A Sprocket's own chat
 * row opens its chats: an attached one's project chat (ADR 0021) first, with its direct chat a tab away. Team chats
 * (ADR 0022) come first, under Teams. On small screens only one of the two shows at a time.
 */
export function SprocketsPage({ route }: { route: SprocketsRoute }) {
  const { list, teams: chats, error } = useSprockets();
  const { projects } = useStore();
  /** Which part of the list shows: all, "teams" (team chats), a project's id, or "general" (unattached). */
  const [filter, setFilter] = useState("all");
  /** The New team dialog (from the list's New menu). */
  const [makingTeam, setMakingTeam] = useState(false);
  // Ready before a settings panel opens: the server can take a moment to list the models.
  useEffect(() => void fetchModelSettings().catch(() => {}), []);

  if (!list) return error ? <p className="error pad" role="alert">{error}</p> : null;
  // A filter for a heading that's gone (its last Sprocket moved or was deleted) shows everything again.
  const shownFilter = filter === "all" || (filter === "teams" ? chats.length > 0 : groupSprockets(list, projects).some((g) => g.key === filter)) ? filter : "all";

  const onTeam = route.view === "team" || route.view === "teamSettings";
  const current = route.id && !onTeam ? list.find((s) => s.id === route.id) : undefined;
  const team = onTeam ? chats.find((g) => g.id === route.id) : undefined;
  const lead = team && list.find((s) => s.id === team.members[0]);
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
  } else if (team && lead) {
    main = (
      <div key={team.id} className="sp-detail">
        <SprocketChat sprocket={lead} chat={team} panelOpen={route.view === "teamSettings"} team={{ info: team, all: list }} />
        {route.view === "teamSettings" && <TeamSettings team={team} all={list} />}
      </div>
    );
  } else if (route.id) {
    main = <p className="sp-placeholder muted">This {onTeam ? "team" : "one"} doesn't exist anymore. It may have been deleted on another device.</p>;
  } else {
    main = <Gallery list={list} />;
  }

  return (
    <div className={"sprockets " + (route.view === "list" && !creating ? "at-list" : "at-detail")}>
      <SprocketList
        list={list}
        chats={chats}
        projects={projects}
        filter={shownFilter}
        onFilter={setFilter}
        onNewTeam={() => setMakingTeam(true)}
        activeId={route.id}
      />
      <section className="sp-main">{main}</section>
      {makingTeam && (
        <TeamDialog
          all={list}
          projects={projects}
          onSaved={(g) => navigate(href.team(g.id))}
          onClose={() => setMakingTeam(false)}
          returnFocus={() => document.querySelector<HTMLElement>(".sp-new-btn")}
        />
      )}
    </div>
  );
}

/**
 * The list column. Its header is a search field; under it, always there so
 * nothing shifts when a group appears, a filter menu named after what it shows: All Sprockets, each project with
 * Sprockets, General. Rows are grouped by project under small headings, after the team chats (ADR 0022): one row per
 * Sprocket, one per team. The New button beside the search makes either. Characters here stand still: a list of
 * faces moving at once is too busy, and a team's row has several.
 */
function SprocketList(props: {
  list: SprocketData[];
  chats: SprocketTeam[];
  projects: Project[];
  filter: string;
  onFilter(key: string): void;
  onNewTeam(): void;
  activeId?: string;
}) {
  const { list, chats, projects, filter, onFilter, onNewTeam, activeId } = props;
  const [query, setQuery] = useState("");
  const all = useMemo(() => groupSprockets(list, projects), [list, projects]);
  const nameOf = (id: string) => list.find((s) => s.id === id)?.name;
  const q = query.trim().toLowerCase();
  const said = (c?: SprocketChatInfo) => !!c?.lastMessage?.text.toLowerCase().includes(q);
  const groups = useMemo(() => {
    const projectName = (s: SprocketData) => projects.find((p) => p.id === s.projectId)?.name.toLowerCase() ?? "";
    const match = (s: SprocketData) => !q || s.name.toLowerCase().includes(q) || projectName(s).includes(q) || said(s.direct) || said(s.projectChat);
    return filter === "teams" ? [] : groupSprockets(list.filter(match), projects, filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, projects, filter, q]);
  // Team chats, the most recently active first.
  const shownChats = (filter === "all" || filter === "teams" ? chats : [])
    .filter((g) => !q || g.name.toLowerCase().includes(q) || g.members.some((m) => nameOf(m)?.toLowerCase().includes(q)) || said(g))
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
  const shownName = filter === "all" ? "All Sprockets" : filter === "teams" ? "Teams" : all.find((g) => g.key === filter)?.title;
  return (
    <aside className="sp-list" aria-labelledby="sp-list-title">
      <h1 id="sp-list-title" className="sr-only">Sprockets</h1>
      <div className="sp-list-head">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search Sprockets" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <MenuButton
          label="New"
          title="New Sprocket or team"
          icon={<Compose size={18} />}
          className="sp-new-btn"
          align="right"
          items={[
            { label: "New Sprocket", icon: <Plus size={16} />, onSelect: () => navigate(href.newSprocket()) },
            { label: "New team", icon: <UsersPlus size={16} />, disabled: list.length < 2, note: list.length < 2 ? "Needs two Sprockets" : undefined, onSelect: onNewTeam },
          ]}
        />
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
            ...(all.length || chats.length ? ["separator" as const] : []),
            ...(chats.length ? [{ label: "Teams", checked: filter === "teams", onSelect: () => onFilter("teams") }] : []),
            ...all.map((g) => ({ label: g.title, checked: filter === g.key, onSelect: () => onFilter(g.key) })),
          ]}
        />
      </div>
      {list.length === 0 ? (
        <p className="muted small pad">Your first one will show up here.</p>
      ) : groups.length === 0 && shownChats.length === 0 ? (
        <p className="muted small pad">No matches</p>
      ) : (
        <div className="sp-groups">
          {shownChats.length > 0 && (
            <section className="sp-group" aria-labelledby="sp-group-teams">
              <h2 id="sp-group-teams" className="sp-group-title">Teams</h2>
              <ul className="sp-rows">
                {shownChats.map((g) => (
                  <li key={g.id}>
                    <TeamRow team={g} list={list} active={g.id === activeId} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.key} className="sp-group" aria-labelledby={`sp-group-${g.key}`}>
              <h2 id={`sp-group-${g.key}`} className="sp-group-title truncate" title={g.title}>{g.title}</h2>
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

/**
 * A Sprocket in the list, by its character and name. It opens its project chat when it has one (ADR 0021), its
 * direct chat otherwise; the line under its name is the newer of the two, and the dot shows replies waiting in either.
 */
function SprocketRow({ sprocket: s, active }: { sprocket: SprocketData; active: boolean }) {
  const chats = [s.direct, ...(s.projectChat ? [s.projectChat] : [])];
  const newest = chats.reduce((a, b) => ((b.lastMessage?.createdAt ?? "") > (a.lastMessage?.createdAt ?? "") ? b : a));
  const shown: SprocketChatInfo = { ...newest, running: chats.some((c) => c.running), pending: chats.reduce((n, c) => n + c.pending, 0) };
  return (
    <a className="sp-row" href={href.sprocket(s.id, !!s.projectChat)} title={s.name} aria-current={active ? "page" : undefined}>
      <Sprocket look={s.look} size={36} seed={s.id} still />
      <RowText name={s.name} chat={shown} />
    </a>
  );
}

/** A team chat (ADR 0022): its members' characters (the lead in front), its name, and the last line with who wrote it. */
function TeamRow({ team: g, list, active }: { team: SprocketTeam; list: SprocketData[]; active: boolean }) {
  const members = g.members.flatMap((m) => list.find((s) => s.id === m) ?? []);
  return (
    <a className="sp-row" href={href.team(g.id)} title={`${g.name}: ${members.map((m) => m.name).join(", ")}`} aria-current={active ? "page" : undefined}>
      <TeamFace looks={members} size={36} />
      <RowText name={g.name} chat={g} nameOf={(id) => list.find((s) => s.id === id)?.name} />
    </a>
  );
}

/**
 * A chat's name, when it was last active (nothing while it's empty, as after Clear), its last line and a dot while a
 * reply waits. In a team, `nameOf` names who wrote the last line.
 */
function RowText({ name, chat, nameOf }: { name: string; chat: SprocketChatInfo; nameOf?(id: string): string | undefined }) {
  return (
    <span className="sp-row-text">
      <span className="sp-row-top">
        <span className="sp-row-name truncate">{name}</span>
        {chat.lastMessage && <span className="muted small session-time">{timeAgo(chat.lastMessage.createdAt)}</span>}
      </span>
      <span className="sp-row-bottom">
        <span className="muted small truncate">{preview(chat, nameOf)}</span>
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
              <Sprocket look={s.look} size={84} seed={s.id} busy={s.running} />
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

/** The list's one-line preview of a chat; in a team, `nameOf` names the member that wrote it. */
function preview(chat: SprocketChatInfo, nameOf?: (id: string) => string | undefined): string {
  if (chat.running) return "Replying…";
  const m = chat.lastMessage;
  if (!m) return "No messages yet";
  if (m.event) return `${m.event.title}: ${m.event.questions?.[0]?.question ?? m.text}`;
  if (m.author === "user") return `You: ${m.text}`;
  if (m.author === "pass") return `${nameOf?.(m.sprocketId) ?? "A deleted Sprocket"} → ${(m.passTo && nameOf?.(m.passTo)) ?? "a teammate"}${m.text ? `: ${m.text}` : ""}`;
  const text = m.card ? (m.card.title ? `Card: ${m.card.title}` : "A card") : m.approval?.status === "pending" ? `Wants to use ${m.approval.server} ${m.approval.tool}` : plain(m.text);
  return nameOf && m.author === "sprocket" ? `${nameOf(m.sprocketId) ?? "A deleted Sprocket"}: ${text}` : text;
}
