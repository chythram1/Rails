import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowDown as ArrowDown, IconChevronLeft as ChevronLeft } from "@tabler/icons-react";
import { GROUP_TURNS_MAX, type Sprocket as SprocketData, type SprocketChatInfo, type SprocketGroup, type SprocketMessage } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { socket } from "../../ws.ts";
import { Composer } from "../Composer.tsx";
import { SavedPromptsMenu } from "../customize/SavedPromptsMenu.tsx";
import { MenuButton } from "../Menu.tsx";
import { useStore } from "../../store.tsx";
import { ChatMenu } from "./ChatMenu.tsx";
import { GroupFace } from "./GroupFace.tsx";
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
 * One of a Sprocket's chats (ADR 0005, 0006, 0021): its direct chat with the user, or its project's chat, where the
 * sessions that waited for the user show (EventRow). The thread opens with the Sprocket itself (once there are
 * messages, one quiet line), and time labels break it up where there are gaps. The user's messages sit on the right,
 * replies on the left, and Rails' own notices (no model yet, errors) in the middle. A reply shows as it's written.
 * `embedded` is the project chat in a workspace's side panel (SidePanel.tsx), which has a header of its own.
 *
 * A group chat (ADR 0022) passes `group` (and its lead as `sprocket`): each member's reply carries its character and
 * name, and the composer can @mention a member.
 */
export function SprocketChat({
  sprocket,
  chat,
  panelOpen,
  embedded = false,
  group,
}: {
  sprocket: SprocketData;
  chat: SprocketChatInfo;
  panelOpen: boolean;
  embedded?: boolean;
  group?: { info: SprocketGroup; all: SprocketData[] };
}) {
  const { id, name } = sprocket;
  const chatId = chat.id;
  const running = chat.running;
  const { projects } = useStore();
  const project = group ? undefined : projects.find((p) => p.id === sprocket.projectId);
  const projectChat = chat.kind === "project";
  const members = group ? group.info.members.flatMap((m) => group.all.find((s) => s.id === m) ?? []) : [sprocket];
  /** Who wrote a message: in a group, the member (gone if it was deleted); otherwise the chat's Sprocket. */
  const speaker = (sprocketId: string) => (group ? group.all.find((s) => s.id === sprocketId) : sprocket);
  /** The chat's name: the group's, or the Sprocket's. */
  const title = group ? group.info.name : name;
  /** What screen readers call it. */
  const chatName = group ? `Group chat ${title}` : projectChat && project ? `${project.name}'s chat with ${name}` : `Chat with ${name}`;
  const [messages, setMessages] = useState<SprocketMessage[] | null>(null);
  /** The reply being revealed (revealText.tsx): while it's written, then as the saved message `id`. */
  const [reveal, setReveal] = useState<{ text: string; live: boolean; id?: string } | null>(null);
  /** The reply's run log while it's written: the step it's on, and what it has done so far. */
  const [activity, setActivity] = useState<{ step: string | null; summary: string | null }>({ step: null, summary: null });
  /** A saved prompt to put in the composer (Customize, ADR 0020). */
  const [fill, setFill] = useState<{ text: string }>();
  /** In a group: the member whose reply is being written, as its typing says (until the list says so too). */
  const [typingBy, setTypingBy] = useState<string>();
  const replier = group ? (group.info.replying ?? typingBy) : id;
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
  const scroll = useThreadScroll(thread, spacer, running, [messages, reveal?.id, shown, running, activity.summary]);

  /** Loads overlap (the first one, every `sprockets.changed`, StrictMode's second run): only the latest applies. */
  const loads = useRef(0);
  const load = useCallback(async () => {
    const n = ++loads.current;
    try {
      const list = await api.chatMessages(chatId);
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
  }, [chatId]);

  useEffect(() => {
    void load();
    return socket.on((m) => {
      if (m.type === "sprockets.changed") void load();
      if (m.type === "sprockets.typing" && m.chatId === chatId) {
        const text = m.text;
        if (text !== null) setTypingBy(m.sprocketId);
        setReveal((r) => (text === null ? r && { ...r, live: false } : { text, live: true }));
      }
      // The summary outlives the run's end by a moment (until the saved reply, which carries it, loads), so
      // it doesn't blink out; a new send or run clears it.
      if (m.type === "sprockets.activity" && m.chatId === chatId) setActivity((a) => ({ step: m.step, summary: m.summary ?? a.summary }));
    });
  }, [load, chatId]);

  // A new run (possibly started on another device; in a group, the next member's turn) starts with "Thinking…", not
  // the last reply.
  const runKey = running ? (group?.info.replying ?? "run") : "";
  useEffect(() => {
    if (running) setReveal((r) => (r?.id ? null : r));
    if (running) setActivity((a) => (reveal?.id ? { step: null, summary: null } : a));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const send = async (text: string) => {
    setError("");
    setReveal(null);
    setActivity({ step: null, summary: null });
    scroll.onSend();
    const pending: SprocketMessage = { id: "pending", sprocketId: id, chatId, author: "user", text, createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), pending]);
    try {
      await api.sendChatMessage(chatId, text);
    } catch (e: any) {
      setError(e.message);
    }
    await load();
  };


  return (
    <section className="sp-chat" {...(embedded ? { "aria-label": chatName } : { "aria-labelledby": "sp-chat-title" })}>
      {!embedded && (
        <header className="sp-head">
          <a className="icon-btn sp-back" href={href.sprockets()} aria-label="All Sprockets">
            <ChevronLeft size={18} />
          </a>
          {group ? <GroupFace looks={members} size={28} /> : <Sprocket look={sprocket.look} size={28} seed={id} />}
          {/* A group's name, then its members. */}
          <h2 id="sp-chat-title" className="truncate" title={group ? `${title} · ${members.map((m) => m.name).join(", ")}` : name}>
            {group ? (
              <>
                {title} <span className="sp-head-sub">{members.map((m) => m.name).join(", ")}</span>
              </>
            ) : (
              name
            )}
          </h2>
          {/* An attached Sprocket's two chats (ADR 0021): its project's, then its own. */}
          {!group && project && sprocket.projectChat && (
            <nav className="sp-chat-tabs" aria-label={`${name}'s chats`}>
              <ChatTab href={href.sprocket(id, true)} current={projectChat} label={project.name} chat={sprocket.projectChat} />
              <ChatTab href={href.sprocket(id)} current={!projectChat} label="Direct" chat={sprocket.direct} />
            </nav>
          )}
          <span className="grow" />
          <ChatMenu chatId={chatId} name={title} project={projectChat ? project?.name : undefined} group={group} empty={!messages?.length} />
          {/* While the settings panel is open, its toggle sits at the panel's top right instead. A group has none. */}
          {!panelOpen && !group && <PanelToggle sprocket={sprocket} project={projectChat} open={false} />}
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
              {group
                ? `This is the beginning of the group chat ${title}.`
                : projectChat && project
                  ? `This is the beginning of ${project.name}'s chat with ${name}.`
                  : `This is the beginning of your chat with ${name}.`}
            </p>
          ) : group ? (
            <div className="sp-intro alone">
              <ul className="sp-intro-members">
                {members.map((m, i) => (
                  <li key={m.id}>
                    <Sprocket look={m.look} size={72} seed={m.id} />
                    <span className="small">{m.name}{i === 0 && <span className="muted"> · lead</span>}</span>
                  </li>
                ))}
              </ul>
              <p className="sp-intro-title">Say hello to {title}</p>
              <p className="muted small">
                {members[0]?.name} answers unless you @mention someone, and a reply can pass the turn on. After {GROUP_TURNS_MAX} replies in a row they wait for you.
              </p>
            </div>
          ) : (
            <div className="sp-intro alone">
              <Sprocket look={sprocket.look} size={120} seed={id} />
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
          // A log: screen readers announce new messages (not the reply while it's being written, which sits
          // in the list, where the reply will be, but hidden from them).
          <ol className="sp-messages" aria-label={chatName} role="log">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const label = !prev || newGroup(prev.createdAt, m.createdAt);
              const by = m.author === "sprocket" ? speaker(m.sprocketId) : undefined;
              // In a group, a member's name heads its replies, once per run of them.
              const author = group && m.author === "sprocket" && (label || prev?.author !== "sprocket" || prev.sprocketId !== m.sprocketId);
              return (
                <li key={m.id + i} className={"sp-message " + m.author}>
                  {label && <time className="sp-stamp" dateTime={m.createdAt}>{stamp(m.createdAt)}</time>}
                  {author && <Author sprocket={by} />}
                  {m.activity && <p className="sp-steps">{m.activity}</p>}
                  {m.event ? (
                    <EventRow message={m} projectId={sprocket.projectId} name={name} />
                  ) : (
                    <p className="sp-bubble">
                      {m.author === "sprocket" && <span className="sr-only">{by?.name ?? "A deleted Sprocket"}: </span>}
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
                    m.suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} projectId={by?.projectId ?? sprocket.projectId} />)}
                  {m.author !== "notice" && <MessageActions text={m.text} at={m.createdAt} now={now} reply={m.author !== "user"} />}
                </li>
              );
            })}
            {running && !reveal?.id && (
              <li className="sp-message sprocket" aria-hidden>
                {group && <Author sprocket={replier ? speaker(replier) : undefined} />}
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
        <p className="sr-only" role="status">{running ? `${(replier && speaker(replier)?.name) || name} is replying` : ""}</p>
      </div>
      <div className="sp-compose">
        {scroll.hidden && (
          <button className="sp-jump" aria-label="Jump to the latest message" title="Jump to latest" onClick={scroll.jumpToLatest}>
            <ArrowDown size={16} />
          </button>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <Composer
          placeholder={group ? `Message ${title}, or @ someone` : `Message ${title}`}
          onSubmit={(text) => void send(text)}
          autoFocus={!embedded}
          compact
          fill={fill}
          mentions={group && members.map((m, i) => ({ name: m.name, note: i === 0 ? "Lead" : undefined, icon: <Sprocket look={m.look} size={18} seed={m.id} still /> }))}
        >
          <SavedPromptsMenu onPick={(text) => setFill({ text })} />
        </Composer>
      </div>
    </section>
  );
}

/** A group member's name over its replies (ADR 0022): its character, standing still, and its name. */
function Author({ sprocket }: { sprocket?: SprocketData }) {
  return (
    <p className="sp-author" aria-hidden>
      {sprocket && <Sprocket look={sprocket.look} size={18} seed={sprocket.id} still />}
      <span>{sprocket?.name ?? "A deleted Sprocket"}</span>
    </p>
  );
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
