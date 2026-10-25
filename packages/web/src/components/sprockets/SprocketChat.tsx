import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { IconArrowDown as ArrowDown, IconChevronLeft as ChevronLeft, IconClock as Clock } from "@tabler/icons-react";
import { type Sprocket as SprocketData, type SprocketChatInfo, type SprocketTeam, type SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../ui/Composer.tsx";
import { SavedPromptsMenu } from "../customize/SavedPromptsMenu.tsx";
import { useStore } from "../../store.tsx";
import { ChatMenu } from "./ChatMenu.tsx";
import { TeamFace } from "./TeamFace.tsx";
import { TeamPanelToggle } from "./TeamSettings.tsx";
import { Sprocket } from "./Sprocket.tsx";
import { PanelToggle } from "./SprocketSettings.tsx";
import { EventRow } from "./EventRow.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { COLORS } from "./characters.ts";
import { rowId, useFlight, useStep } from "./flight.ts";
import { VIEW } from "./Sprocket.tsx";
import { useThreadScroll } from "./threadScroll.ts";
import { TeamThinking } from "./TeamThinking.tsx";
import { findNames } from "./mentions.ts";
import { blocks, type Block } from "./marks.ts";
import { Card } from "./Card.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";

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
 * One of a Sprocket's chats (ADR 0005, 0006, 0021): its direct chat with the user, or its project's chat, where the
 * sessions that waited for the user show (EventRow). The thread opens with the Sprocket itself (once there are
 * messages, one quiet line), and time labels break it up where there are gaps. The user's messages sit on the right,
 * replies on the left, both as bubbles, and Rails' own notices (no model yet, errors) in the middle. As in a text
 * app, a reply isn't shown as it's written: the Sprocket's face pops up at the bottom left once it has the message,
 * turns into dots in its colour while it writes, and the reply then pops in whole, one bubble per message, paragraphs
 * and all. What it looked at (its codemode steps) isn't shown. `embedded` is the project chat in a workspace's side panel (SidePanel.tsx), which has a header
 * of its own.
 *
 * A team chat (ADR 0022, 0033) passes `team` (and its first member as `sprocket`): each member's run of replies has its
 * name above (in its colour) and its face at the foot. Every member reads every message, several at once: an icon at
 * the bottom left turns from one member into the next, with a line naming those thinking ("Bo and Cy are
 * thinking…"); no typing dots. Members' names read as
 * chips, with an @ or without, and the composer completes @mentions. A question with options shows as buttons under it
 * until it's answered (ADR 0023). Pass lines from before ADR 0033 aren't shown.
 */
export function SprocketChat({
  sprocket,
  chat,
  panelOpen,
  embedded = false,
  team,
}: {
  sprocket: SprocketData;
  chat: SprocketChatInfo;
  panelOpen: boolean;
  embedded?: boolean;
  team?: { info: SprocketTeam; all: SprocketData[] };
}) {
  const { id, name } = sprocket;
  const chatId = chat.id;
  const running = chat.running;
  const { projects } = useStore();
  const project = team ? undefined : projects.find((p) => p.id === sprocket.projectId);
  const projectChat = chat.kind === "project";
  const members = team ? team.info.members.flatMap((m) => team.all.find((s) => s.id === m) ?? []) : [sprocket];
  /** Who wrote a message: in a team, the member (gone if it was deleted); otherwise the chat's Sprocket. */
  const speaker = (sprocketId: string) => (team ? team.all.find((s) => s.id === sprocketId) : sprocket);
  /** The chat's name: the team's, or the Sprocket's. */
  const title = team ? team.info.name : name;
  /** What screen readers call it. */
  const chatName = team ? `Team chat ${title}` : projectChat && project ? `${project.name}'s chat with ${name}` : `Chat with ${name}`;
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
  /** A saved prompt to put in the composer (Customize, ADR 0020). */
  const [fill, setFill] = useState<{ text: string }>();
  /** The Sprocket whose reply has started (its typing says so): its face shows as dots. */
  const [typingBy, setTypingBy] = useState<string | null>(null);
  /** Sent, with no run started yet: the face shows at once, as if it saw the message. */
  const [expecting, setExpecting] = useState(false);
  /** The messages of the first load: they're there already, so they don't pop in. */
  const initial = useRef<Set<string> | null>(null);
  /** Who's on it, at the bottom left: the members replying, then those woken and about to; or the Sprocket. */
  const turns = team ? [...team.info.replying, ...team.info.waiting] : running || expecting ? [id] : [];
  const watching = [...new Set(turns)];
  /** Writing now: the member whose reply has started. */
  const writing = typingBy;
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
  const scroll = useThreadScroll(thread, spacer, running || watching.length > 0, [messages, running, watching.join(), typingBy]);

  /** Loads overlap (the first one, every `sprockets.changed`, StrictMode's second run): only the latest applies. */
  const loads = useRef(0);
  const load = useCallback(async () => {
    const n = ++loads.current;
    try {
      // An automation's run that found nothing new leaves no line (ADR 0032): its runs list in Automate has it.
      const list = (await api.chatMessages(chatId)).filter((m) => !m.automation?.quiet);
      if (n !== loads.current) return; // a newer load is on its way, and an older answer would undo it
      initial.current ??= new Set(list.map((m) => m.id));
      // Something came back (a reply, or Rails' notice that none will): stop showing the face for the message sent.
      if (list.at(-1)?.author !== "user") setExpecting(false);
      setMessages(list);
      setLoadError("");
    } catch (e: any) {
      if (n === loads.current) setLoadError(e.message);
    }
  }, [chatId]);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
      // The reply itself isn't shown as it's written: only that it is.
      if (m.type === "sprockets.typing" && m.chatId === chatId) setTypingBy(m.text ? m.sprocketId : null);
    });
  }, [load, chatId]);

  useEffect(() => {
    if (running) setExpecting(false);
  }, [running]);

  const send = async (text: string) => {
    setError("");
    setExpecting(true);
    scroll.onSend();
    const pending: SprocketMessage = { id: "pending", sprocketId: id, chatId, author: "user", text, createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), pending]);
    try {
      await api.sendChatMessage(chatId, text);
    } catch (e: any) {
      setError(e.message);
      setExpecting(false);
    }
    await load();
  };
  /** In a team, members' names read as chips. */
  const text = (t: string) => (team ? withMentions(t, members) : t);

  // Who's on it, in a direct or project chat: an icon by the reply in flight that is the Sprocket's row in the list
  // (FlightIcon, ADR 0035): it becomes three dots while it thinks, and goes once the reply is done, when the row
  // plays its done animation. A team has no dots (ADR 0033): one icon turns from one member into the next, round those
  // thinking since the message (TeamThinking), with a line naming those still at it; it goes when the replies land.
  // In a team, in the team's order, so the line naming them doesn't reorder as runs start and end.
  const onIt = team ? members.filter((m) => watching.includes(m.id)) : watching.flatMap((w) => speaker(w) ?? []);
  const one = team ? undefined : onIt[0];
  /**
   * In a team, who's thinking now, by name: "Bo is thinking…", "Bo and Cy are thinking…". A member stays named a
   * moment after it stops, so one that rereads quietly for a moment (a teammate's reply woke it) doesn't flicker in and out.
   */
  const named = useLinger(onIt.map((w) => w.id), LINGER_MS);
  const namedNow = members.filter((m) => named.includes(m.id));
  const thinking = team && namedNow.length ? `${names(namedNow.map((w) => w.name))} ${namedNow.length === 1 ? "is" : "are"} thinking…` : "";
  /** In a team, the members the icon turns through: all those thinking since it started, until none is. */
  const [cycle, setCycle] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (team) setCycle((c) => (named.length ? [...c, ...named.filter((w) => !c.includes(w))] : []));
  }, [named.join()]);
  const cycling = team ? cycle.flatMap((c) => speaker(c) ?? []) : [];


  return (
    <section className="sp-chat" {...(embedded ? { "aria-label": chatName } : { "aria-labelledby": "sp-chat-title" })}>
      {!embedded && (
        <header className="sp-head">
          <a className="icon-btn sp-back" href={href.sprockets()} aria-label="All Sprockets">
            <ChevronLeft size={18} />
          </a>
          {team ? <TeamFace looks={members} size={28} /> : <Sprocket look={sprocket.look} size={28} activity={running ? "think" : "idle"} />}
          {/* A team's name, then its members. */}
          <h2 id="sp-chat-title" className="truncate" title={team ? `${title} · ${members.map((m) => m.name).join(", ")}` : name}>
            {team ? (
              <>
                {title} <span className="sp-head-sub">{members.map((m) => m.name).join(", ")}</span>
              </>
            ) : (
              name
            )}
          </h2>
          {/* An attached Sprocket's two chats (ADR 0021): its project's, then its own. */}
          {!team && project && sprocket.projectChat && (
            <nav className="sp-chat-tabs" aria-label={`${name}'s chats`}>
              <ChatTab href={href.sprocket(id, true)} current={projectChat} label={project.name} chat={sprocket.projectChat} />
              <ChatTab href={href.sprocket(id)} current={!projectChat} label="Direct" chat={sprocket.direct} />
            </nav>
          )}
          <span className="grow" />
          <ChatMenu chatId={chatId} name={title} project={projectChat ? project?.name : undefined} team={!!team} empty={!messages?.length} />
          {/* While the settings panel is open, its toggle sits at the panel's top right instead. */}
          {!panelOpen && (team ? <TeamPanelToggle team={team.info} open={false} /> : <PanelToggle sprocket={sprocket} project={projectChat} open={false} />)}
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
            <p className="sp-intro-line muted small">
              {team
                ? `This is the beginning of the team chat ${title}.`
                : projectChat && project
                  ? `This is the beginning of ${project.name}'s chat with ${name}.`
                  : `This is the beginning of your chat with ${name}.`}
            </p>
          ) : team ? (
            <div className="sp-intro alone">
              <ul className="sp-intro-members">
                {members.map((m, i) => (
                  <li key={m.id}>
                    <Sprocket look={m.look} size={72} />
                    <span className="small">{m.name}</span>
                  </li>
                ))}
              </ul>
              <p className="sp-intro-title">Say hello to {title}</p>
              <p className="muted small">
                Everyone reads every message, and whoever has something to add answers. @mention someone to ask only them.
              </p>
            </div>
          ) : (
            <div className="sp-intro alone">
              <Sprocket look={sprocket.look} size={120} />
              {projectChat && project ? (
                <>
                  <p className="sp-intro-title">{project.name}'s chat</p>
                  <p className="muted small">{name} posts here when a session in {project.name} needs you. Tell it here who owns what, or what to pass on.</p>
                </>
              ) : (
                <>
                  <p className="sp-intro-title">Say hello to {name}</p>
                  <p className="muted small">
                    {project ? `${name} looks after ${project.name}. What its sessions need goes to the project chat.` : `${name} isn't attached to a project. You can attach it in Settings.`}
                  </p>
                </>
              )}
            </div>
          ))}
        {!!messages?.length && (
          // A log: screen readers announce new messages.
          <ol className={"sp-messages" + (team ? " in-team" : "")} aria-label={chatName} role="log">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const label = !prev || newGroup(prev.createdAt, m.createdAt);
              const by = m.author === "sprocket" ? speaker(m.sprocketId) : undefined;
              // A run of one member's replies: its name heads the first, its face sits at the foot of the last.
              const same = (a?: SprocketMessage) => a?.author === "sprocket" && a.sprocketId === m.sprocketId;
              const first = label || !same(prev);
              const last = !same(next) || newGroup(m.createdAt, next!.createdAt);
              // The same author again, soon after: it sits close under the one before, as in a text app.
              const cont = !label && prev?.author === m.author && (m.author !== "sprocket" || same(prev)) && (m.author === "user" || m.author === "sprocket");
              const pop = m.author === "sprocket" && !!initial.current && !initial.current.has(m.id);
              // A member gave a teammate the turn (before ADR 0033): not shown.
              if (m.author === "pass") return null;
              // An automation started a run (ADR 0032): a line naming it, as a pass line is.
              if (m.author === "automation") {
                return (
                  <li key={m.id} className={"sp-message pass" + (pop ? " pop" : "")}>
                    {label && <time className="sp-stamp" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>}
                    <p className="sp-pass">
                      <Clock size={14} aria-hidden />
                      {m.automation ? (
                        <a className="sp-pass-to" href={href.automation(m.automation.id)}>
                          {m.automation.name}
                        </a>
                      ) : (
                        <span className="sp-pass-to">An automation</span>
                      )}
                      <span className="sp-pass-note">{m.automation?.trigger === "manual" ? "run now" : "on its schedule"}</span>
                    </p>
                  </li>
                );
              }
              // A question with options waiting for an answer: the options to tap, under its last bubble. A message
              // for someone else leaves it waiting, so they stay until it's answered.
              const options = m.ask && !m.ask.answer ? m.ask.options : undefined;
              // One bubble per message, paragraphs and all. A code block can't go in a <p>.
              const read = m.author === "notice" || m.card || m.approval ? undefined : blocks(m.text);
              const Bubble = read?.some((b) => b.kind === "fence") ? "div" : "p";
              return (
                <li key={m.id} className={"sp-message " + m.author + (cont ? " cont" : "") + (pop ? " pop" : "")} style={by ? ({ "--who": COLORS[by.look.color] } as CSSProperties) : undefined}>
                  {label && <time className="sp-stamp" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>}
                  {team && m.author === "sprocket" && first && <p className="sp-author" aria-hidden>{by?.name ?? "A deleted Sprocket"}</p>}
                  {m.event ? (
                    <EventRow message={m} projectId={sprocket.projectId} name={name} />
                  ) : (
                    <div className="sp-said">
                      {team && m.author === "sprocket" && (
                        <span className="sp-avatar" aria-hidden>
                          {/* Done: turned and leaning toward its message, still: a team chat leaves nothing to celebrate (ADR 0035). */}
                          {last && by && <DoneFace look={by.look} />}
                        </span>
                      )}
                      <div className="sp-bubbles">
                        {m.card && (
                          <>
                            <span className="sr-only">{by?.name ?? "A deleted Sprocket"} showed a card:</span>
                            <Card card={m.card} messageId={m.id} />
                          </>
                        )}
                        {m.approval && <ApprovalCard messageId={m.id} approval={m.approval} name={by?.name ?? "A deleted Sprocket"} />}
                        {!m.card && !m.approval && (
                          // The time and copy sit beside the bubble, on its inner side, so a run of messages stays close.
                          <div className="sp-line">
                            {/* Focusable by a tap (not by Tab), so a touch screen can show its details. */}
                            <Bubble className="sp-bubble" tabIndex={m.author === "notice" ? undefined : -1}>
                              {m.author === "sprocket" && <span className="sr-only">{by?.name ?? "A deleted Sprocket"}: </span>}
                              {read ? <Marked blocks={read} text={text} /> : m.text}
                            </Bubble>
                            {m.author !== "notice" && <MessageActions text={m.text} at={m.createdAt} now={now} reply={m.author !== "user"} />}
                          </div>
                        )}
                        {!!options?.length && (
                          <div className="sp-ask" role="group" aria-label="Answers to pick">
                            {options.map((o) => (
                              <button key={o} type="button" className="btn small" onClick={() => void send(o)}>
                                {o}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* A Coordinator's suggested replies. */}
                  {m.suggestions?.map((s) => <SuggestionCard key={s.id} suggestion={s} projectId={by?.projectId ?? sprocket.projectId} />)}
                  {/* Cards and session events are wide: their details go under them. */}
                  {(m.card || m.approval || m.event) && <MessageActions text={m.text} at={m.createdAt} now={now} reply={m.author !== "user"} />}
                </li>
              );
            })}
            {/* Who's on it (above): in a team, the icon that turns through the members thinking; otherwise the
                Sprocket's row, mirrored. */}
            {team && thinking && cycling.length > 0 && (
              <li className="sp-message sprocket sp-watching team" aria-hidden>
                <span className="sp-watcher">
                  <TeamThinking looks={cycling.map((m) => ({ id: m.id, look: m.look }))} size={26} />
                </span>
                <span className="sp-working">{thinking}</span>
              </li>
            )}
            {one && (
              <li className="sp-message sprocket sp-watching" aria-hidden>
                <FlightIcon who={one} working={running} />
              </li>
            )}
          </ol>
        )}
        <div className="sp-spacer" ref={spacer} aria-hidden />
        <div className="sp-fade" aria-hidden />
        <p className="sr-only" role="status">{thinking || (writing ? `${speaker(writing)?.name ?? name} is typing` : "")}</p>
      </div>
      <div className="sp-compose">
        {scroll.hidden && (
          <button className="sp-jump" aria-label="Jump to the latest message" title="Jump to latest" onClick={scroll.jumpToLatest}>
            <ArrowDown size={16} />
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <Composer
          placeholder={team ? `Message ${title}, or @ someone` : `Message ${title}`}
          onSubmit={(text) => void send(text)}
          autoFocus={!embedded}
          compact
          fill={fill}
          mentions={
            team && [
              ...members.map((m) => ({ name: m.name, note: "Only them", icon: <Sprocket look={m.look} size={18} still /> })),
            ]
          }
        >
          <SavedPromptsMenu onPick={(text) => setFill({ text })} />
        </Composer>
      </div>
    </section>
  );
}

/** A bubble's code blocks, `code` and **bold** (marks.ts); `text` draws the plain text (with its @mentions). */
function Marked({ blocks: read, text }: { blocks: Block[]; text: (t: string) => ReactNode }) {
  return read.map((b, i) =>
    b.kind === "fence" ? (
      <pre key={i} className="sp-pre">
        <code>{b.code}</code>
      </pre>
    ) : (
      <Fragment key={i}>
        {b.marks.map((m, k) =>
          m.kind === "code" ? (
            <code key={k} className="sp-code">
              {m.text}
            </code>
          ) : m.kind === "strong" ? (
            <strong key={k}>{text(m.text)}</strong>
          ) : (
            <Fragment key={k}>{text(m.text)}</Fragment>
          ),
        )}
      </Fragment>
    ),
  );
}

/** How long a team member stays named in the thinking line after it stops (ms). */
const LINGER_MS = 800;

/** `ids`, with each one that leaves kept for `ms` more (it's back at once if it returns meanwhile). */
function useLinger(ids: string[], ms: number): string[] {
  const [kept, setKept] = useState<string[]>([]);
  const key = ids.join();
  useLayoutEffect(() => {
    setKept((k) => [...ids, ...k.filter((x) => !ids.includes(x))]);
    if (!ids.length && !kept.length) return;
    const t = setTimeout(() => setKept(ids), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return kept;
}

/** Names as a sentence: "Bo", "Bo and Cy", "Ada, Bo and Cy". */
const names = (list: string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** A message with team members' names as chips (ADR 0022, 0033): the member's face and its whole name. */
function withMentions(text: string, members: SprocketData[]): ReactNode {
  if (!members.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const found of findNames(text, members.map((m) => m.name))) {
    const m = members[found.member];
    parts.push(text.slice(at, found.start));
    parts.push(
      <span key={found.start} className="sp-mention" style={{ "--who": COLORS[m.look.color] } as CSSProperties}>
        <Sprocket look={m.look} size={14} still />
        {found.at && <span className="sr-only">@</span>}
        {m.name}
      </span>,
    );
    at = found.end;
  }
  parts.push(text.slice(at));
  return parts;
}

/** One of an attached Sprocket's chats in its header: a tab-like link, with a dot while a reply waits there. */
function ChatTab({ href: to, current, label, chat }: { href: string; current: boolean; label: string; chat: SprocketChatInfo }) {
  return (
    <a className="sp-chat-tab" href={to} aria-current={current ? "page" : undefined} title={label}>
      <span className="truncate">{label}</span>
      {!current && chat.pending > 0 && <span className="tab-attention" role="img" aria-label={chat.pending > 1 ? `${chat.pending} replies ready` : "A reply is ready"} />}
    </a>
  );
}

/** A team member's face at the foot of its last message: looking up toward it, still (ADR 0035). */
function DoneFace({ look }: { look: SprocketData["look"] }) {
  return <Sprocket look={look} size={26} stance="toward" still />;
}

/**
 * The icon by a reply in flight in a direct or project chat (ADR 0035): the Sprocket's row in the list, the same
 * drawing (`<use>`), so they move exactly alike, with the tool step it's on beside it. Where the list isn't on screen
 * it's a Sprocket of its own, playing the same (useFlight).
 */
function FlightIcon({ who, working }: { who: SprocketData; working: boolean }) {
  const id = rowId(who.id);
  const [mirror, setMirror] = useState(false);
  useLayoutEffect(() => setMirror(!!document.getElementById(id)), [id]);
  const flight = useFlight(who.id, working);
  const step = useStep(who.id);
  return (
    <>
      <span className="sp-watcher">
        {mirror ? (
          <svg className="sp-flight" viewBox={`0 0 50 ${(50 * VIEW.h) / VIEW.w}`}>
            <use href={`#${id}`} />
          </svg>
        ) : (
          <Sprocket look={who.look} size={26} dots={flight.dots} play={flight.play} />
        )}
      </span>
      {working && step && <span className="sp-working">{step}</span>}
    </>
  );
}
