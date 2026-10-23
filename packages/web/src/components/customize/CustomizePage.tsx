import { useEffect, useMemo, useState } from "react";
import {
  IconBook as Book,
  IconCheck as Check,
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconFolderOpen as FolderOpen,
  IconMessage as Message,
  IconPlug as Plug,
  IconPlus as Plus,
  IconSearch as Search,
  IconTerminal2 as Terminal,
} from "@tabler/icons-react";
import {
  CONNECTOR_COLLECTIONS,
  CONNECTOR_GROUPS,
  CONNECTORS,
  connectorById,
  type Connector,
  type McpServer,
  type SavedPrompt,
  type Skill,
  type SkillSource,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type CustomizeTab, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { MenuButton } from "../Menu.tsx";
import { Segmented } from "../Segmented.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { ConnectorPage } from "./ConnectorPage.tsx";
import { McpEditor, serverSummary } from "./McpEditor.tsx";
import { NewItem } from "./NewItem.tsx";
import { PromptEditor } from "./PromptEditor.tsx";
import { SkillEditor } from "./SkillEditor.tsx";

type CustomizeRoute = Extract<Route, { name: "customize" }>;
type Mode = "yours" | "discover";

const TABS: { id: CustomizeTab; label: string }[] = [
  { id: "connectors", label: "Connectors" },
  { id: "skills", label: "Skills" },
  { id: "prompts", label: "Prompts" },
];

/** Yours or Discover per tab, kept while the app is open (coming back from an item lands where you were). */
const modes: Partial<Record<CustomizeTab, Mode>> = {};

/**
 * Customize (ADR 0025): what Sprockets can use, as a page of cards. Tabs for connectors (MCP servers), skills and
 * saved prompts; Yours shows what's here, Discover what can be added (Rails' connectors, your agents' skills).
 * One item opens full width in its place, with a way back. A Sprocket picks its servers and skills in its settings.
 */
export function CustomizePage({ route }: { route: CustomizeRoute }) {
  const { mcpServers, skills, savedPrompts } = useStore();
  if (!mcpServers || !skills || !savedPrompts) return null;

  if (route.view === "new")
    return (
      <div className="cz-detail">
        <NewItem key={route.draft} draft={route.draft} />
      </div>
    );
  if (route.view !== "home") {
    const server = route.view === "mcp" ? mcpServers.find((s) => s.id === route.id) : undefined;
    const skill = route.view === "skill" ? skills.find((s) => s.id === route.id) : undefined;
    const prompt = route.view === "prompt" ? savedPrompts.find((p) => p.id === route.id) : undefined;
    const connector = route.view === "connector" ? connectorById(route.id) : undefined;
    return (
      <div className="cz-detail">
        {server ? (
          <McpEditor key={server.id} server={server} />
        ) : skill ? (
          <SkillEditor key={skill.id} skill={skill} />
        ) : prompt ? (
          <PromptEditor key={prompt.id} prompt={prompt} />
        ) : connector ? (
          <ConnectorPage connector={connector} added={mcpServers.filter((s) => s.connector === connector.id)} />
        ) : (
          <div className="cz-gone">
            <p className="muted">This one doesn't exist anymore. It may have been deleted on another device.</p>
            <a href={href.customize(route.tab)}>Back to Customize</a>
          </div>
        )}
      </div>
    );
  }
  return <Gallery tab={route.tab} servers={mcpServers} skills={skills} prompts={savedPrompts} />;
}

function Gallery({ tab, servers, skills, prompts }: { tab: CustomizeTab; servers: McpServer[]; skills: Skill[]; prompts: SavedPrompt[] }) {
  const has = tab === "connectors" ? servers.length : tab === "skills" ? skills.length : prompts.length;
  const [mode, setModeState] = useState<Mode>(modes[tab] ?? (has ? "yours" : "discover"));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setModeState(modes[tab] ?? (has ? "yours" : "discover"));
    setQuery("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the tab changes
  }, [tab]);
  const setMode = (m: Mode) => {
    modes[tab] = m;
    setModeState(m);
  };
  // New ones open as drafts: nothing is created until their page's Create.
  const newServer = (transport: "http" | "stdio") => navigate(href.newItem(transport));
  const newSkill = () => navigate(href.newItem("skill"));
  const newPrompt = () => navigate(href.newItem("prompt"));
  const q = query.trim().toLowerCase();

  return (
    <div className="cz-page">
      <div className="cz-page-inner">
        <h1 className="cz-title">Customize</h1>
        <p className="cz-lead">What your Sprockets can use. Give each one the connectors and skills it needs in its settings, under Tools.</p>
        <div className="cz-toolbar">
          <nav className="cz-tabs" aria-label="Customize">
            {TABS.map((t) => (
              <a key={t.id} href={href.customize(t.id)} className="cz-tab" aria-current={t.id === tab ? "page" : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
          {tab !== "prompts" && (
            <Segmented
              name="cz-mode"
              aria-labelledby="cz-mode-label"
              value={mode}
              options={[
                { value: "yours", label: "Yours" },
                { value: "discover", label: "Discover" },
              ]}
              onChange={setMode}
            />
          )}
          <span id="cz-mode-label" className="sr-only">
            Show
          </span>
          <span className="grow" />
          <label className="cz-search">
            <Search size={15} aria-hidden />
            <input type="search" placeholder="Search" aria-label={`Search ${tab}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <MenuButton
            label="Add"
            title="Add a connector, skill or prompt"
            plain
            className="btn primary cz-add"
            icon={
              <span className="cz-add-label">
                <Plus size={16} aria-hidden /> Add
              </span>
            }
            align="right"
            items={[
              { label: "Browse connectors", icon: <Plug size={16} />, onSelect: () => (navigate(href.customize("connectors")), (modes.connectors = "discover"), setMode("discover")) },
              { label: "Custom server with a URL", icon: <Plug size={16} />, onSelect: () => void newServer("http") },
              { label: "Custom server with a command", icon: <Terminal size={16} />, onSelect: () => void newServer("stdio") },
              "separator",
              { label: "New skill", icon: <Book size={16} />, onSelect: () => void newSkill() },
              { label: "Copy in a skill", icon: <Book size={16} />, onSelect: () => ((modes.skills = "discover"), navigate(href.customize("skills")), setMode("discover")) },
              "separator",
              { label: "New prompt", icon: <Message size={16} />, onSelect: () => void newPrompt() },
            ]}
          />
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tab === "connectors" &&
          (mode === "discover" ? (
            <DiscoverConnectors servers={servers} query={q} onError={setError} onCustom={(t) => void newServer(t)} />
          ) : (
            <YourConnectors servers={servers} query={q} onBrowse={() => setMode("discover")} onCustom={(t) => void newServer(t)} />
          ))}
        {tab === "skills" &&
          (mode === "discover" ? (
            <DiscoverSkills skills={skills} query={q} onError={setError} />
          ) : (
            <YourSkills skills={skills} query={q} onNew={() => void newSkill()} onBrowse={() => setMode("discover")} />
          ))}
        {tab === "prompts" && <YourPrompts prompts={prompts} query={q} onNew={() => void newPrompt()} />}
      </div>
    </div>
  );
}

const matches = (q: string, ...texts: (string | undefined)[]) => !q || texts.some((t) => t?.toLowerCase().includes(q));

function Section({ title, count, blurb, children, action }: { title: string; count?: number; blurb?: string; children: React.ReactNode; action?: React.ReactNode }) {
  const id = `cz-sec-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="cz-section" aria-labelledby={id}>
      <div className="cz-section-head">
        <h2 id={id}>
          {title}
          {count !== undefined && <span className="cz-count">{count}</span>}
        </h2>
        {blurb && <p className="cz-section-blurb">{blurb}</p>}
        {action}
      </div>
      <ul className="cz-cards">{children}</ul>
    </section>
  );
}

/**
 * A card: a mark, the name (a link that covers the card), a line or two under it, a small line of facts, and at the
 * top right one action (a "+" or a check) that sits above the link.
 */
function Card(props: { href?: string; mark: React.ReactNode; name: string; text: string; meta?: React.ReactNode; action?: React.ReactNode; warn?: string }) {
  return (
    <li className="cz-card">
      {props.mark}
      <div className="cz-card-text">
        {props.href ? (
          <a className="cz-card-name" href={props.href}>
            {props.name}
          </a>
        ) : (
          <span className="cz-card-name">{props.name}</span>
        )}
        <p className="cz-card-desc">{props.text}</p>
        {(props.meta || props.warn) && (
          <p className="cz-card-meta">
            {props.warn && <span className="cz-card-warn">{props.warn}</span>}
            {props.warn && props.meta && " · "}
            {props.meta}
          </p>
        )}
      </div>
      {props.action && <div className="cz-card-action">{props.action}</div>}
    </li>
  );
}

/** A dashed card that adds something. */
function AddCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick(): void }) {
  return (
    <li className="cz-card cz-card-add">
      <button type="button" className="cz-card-add-btn" onClick={onClick}>
        <span className="cz-logo cz-logo-add" aria-hidden>
          {icon}
        </span>
        <span className="cz-card-text">
          <span className="cz-card-name">{title}</span>
          <span className="cz-card-desc">{text}</span>
        </span>
      </button>
    </li>
  );
}

const SETUP_LABEL: Record<Connector["setup"], string> = {
  "sign-in": "Sign in",
  none: "No account",
  token: "Token",
  "own-app": "Your own app",
  folder: "Pick a folder",
};

/** Rails' connectors, by group under a banner, then the custom ones. */
function DiscoverConnectors({ servers, query, onError, onCustom }: { servers: McpServer[]; query: string; onError(e: string): void; onCustom(t: "http" | "stdio"): void }) {
  const [busy, setBusy] = useState("");
  const add = async (c: Connector) => {
    // Those needing something first (a token, a folder, an app) open their page.
    if (c.setup === "token" || c.setup === "own-app" || c.setup === "folder") return navigate(href.connector(c.id));
    onError("");
    setBusy(c.id);
    try {
      const made = await api.addConnector(c.id);
      navigate(href.mcpServer(made.id));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy("");
    }
  };
  const shown = CONNECTORS.filter((c) => matches(query, c.name, c.description, c.by));
  return (
    <>
      {!query && <Banner servers={servers} />}
      {CONNECTOR_GROUPS.map((g) => {
        const list = shown.filter((c) => c.group === g.id);
        if (!list.length) return null;
        return (
          <Section key={g.id} title={g.title} count={list.length} blurb={g.blurb}>
            {list.map((c) => {
              const added = servers.find((s) => s.connector === c.id);
              return (
                <Card
                  key={c.id}
                  href={added ? href.mcpServer(added.id) : href.connector(c.id)}
                  mark={<ConnectorLogo id={c.id} />}
                  name={c.name}
                  text={c.description}
                  meta={`by ${c.by} · ${SETUP_LABEL[c.setup]}`}
                  action={
                    added ? (
                      <span className="cz-added" title="Added" aria-label={`${c.name} is added`}>
                        <Check size={16} aria-hidden />
                      </span>
                    ) : (
                      <button type="button" className="icon-btn cz-plus" aria-label={`Add ${c.name}`} title={`Add ${c.name}`} disabled={!!busy} onClick={() => void add(c)}>
                        {busy === c.id ? <span className="cz-spinner" aria-hidden /> : <Plus size={16} />}
                      </button>
                    )
                  }
                />
              );
            })}
          </Section>
        );
      })}
      {!query && <CustomSection onCustom={onCustom} />}
      {query && !shown.length && <p className="muted cz-none">No connectors match. Add it as a custom server with its URL or command.</p>}
    </>
  );
}

function CustomSection({ onCustom }: { onCustom(t: "http" | "stdio"): void }) {
  return (
    <Section title="Custom" blurb="Any other MCP server: one on the web by its URL, or a program Rails runs on this computer.">
      <AddCard icon={<Plug size={20} />} title="A server on the web" text="Paste its URL (Streamable HTTP). Sign in or add a token after." onClick={() => onCustom("http")} />
      <AddCard icon={<Terminal size={20} />} title="A program on this computer" text="A command such as npx or uvx, with its arguments and keys." onClick={() => onCustom("stdio")} />
    </Section>
  );
}

/** A collection of connectors at the top of Discover: what it's for, and their marks to open. Arrows go through them. */
function Banner({ servers }: { servers: McpServer[] }) {
  // Every collection is drawn, stacked in one cell, so the banner keeps the tallest one's size; only the shown one
  // is visible. `dir` is which way it went, for the slide; `from` the one going out.
  const [{ at, from, dir }, setState] = useState({ at: 0, from: -1, dir: 1 });
  const n = CONNECTOR_COLLECTIONS.length;
  const go = (d: number) => setState((s) => ({ at: (s.at + d + n) % n, from: s.at, dir: d }));
  const slide = (i: number) => ({
    className: "cz-slide" + (i === at ? " on" : i === from ? " out" : ""),
    "aria-hidden": i !== at,
    inert: i !== at,
  });
  return (
    <section className="cz-banner" aria-roledescription="carousel" aria-label="Collections" style={{ "--dir": dir } as React.CSSProperties}>
      <div className="cz-banner-text cz-stack">
        {CONNECTOR_COLLECTIONS.map((c, i) => (
          <div key={c.title} {...slide(i)}>
            <p className="cz-banner-eyebrow">{c.eyebrow}</p>
            <h2 className="cz-banner-title">{c.title}</h2>
            <p className="cz-banner-lead">{c.text}</p>
          </div>
        ))}
      </div>
      <div className="cz-banner-marks cz-stack">
        {CONNECTOR_COLLECTIONS.map((c, i) => (
          <ul key={c.title} {...slide(i)}>
            {c.ids.map((id, j) => {
              const conn = connectorById(id)!;
              const added = servers.find((s) => s.connector === id);
              return (
                <li key={id} style={{ "--i": j } as React.CSSProperties}>
                  <a href={added ? href.mcpServer(added.id) : href.connector(id)} title={conn.name} aria-label={`${conn.name}${added ? " (added)" : ""}`}>
                    <ConnectorLogo id={id} size={j % 2 ? 52 : 60} />
                    {added && (
                      <span className="cz-banner-added" aria-hidden>
                        <Check size={12} />
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {CONNECTOR_COLLECTIONS[at].title}
      </span>
      <div className="cz-banner-nav">
        <button type="button" className="icon-btn" aria-label="Previous collection" onClick={() => go(-1)}>
          <ChevronLeft size={18} />
        </button>
        <span className="cz-banner-dots" aria-hidden>
          {CONNECTOR_COLLECTIONS.map((_, i) => (
            <span key={i} className={i === at ? "on" : ""} />
          ))}
        </span>
        <span className="sr-only">
          {at + 1} of {CONNECTOR_COLLECTIONS.length}
        </span>
        <button type="button" className="icon-btn" aria-label="Next collection" onClick={() => go(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}

/** What a server is like now, in a few words, and whether that wants attention. */
function serverState(s: McpServer): { text: string; warn?: string } {
  const setup = connectorById(s.connector)?.setup;
  if (s.signIn?.authUrl) return { text: "", warn: "Signing in" };
  if (s.signIn?.state === "needed") return { text: "", warn: "Sign in" };
  // A connector that signs in, and hasn't yet: say what it needs instead of "not connected".
  if (s.signIn?.state !== "signed-in" && setup === "own-app" && !s.signIn?.clientId) return { text: "", warn: "Set up your app" };
  if (s.signIn?.state !== "signed-in" && (setup === "sign-in" || setup === "own-app")) return { text: "", warn: "Sign in" };
  if (s.status.state === "error") return { text: "", warn: "Can't connect" };
  if (s.status.state === "unknown" && !s.toolsAt) return { text: "Not connected yet" };
  return { text: serverSummary(s) };
}

function YourConnectors({ servers, query, onBrowse, onCustom }: { servers: McpServer[]; query: string; onBrowse(): void; onCustom(t: "http" | "stdio"): void }) {
  const shown = servers.filter((s) => {
    const c = connectorById(s.connector);
    return matches(query, s.name, s.description, c?.name, c?.by, s.url, s.command);
  });
  return (
    <>
      <Section title="Your connectors" count={servers.length}>
        {shown.map((s) => {
          const c = connectorById(s.connector);
          const state = serverState(s);
          const users = s.usedBy.length;
          return (
            <Card
              key={s.id}
              href={href.mcpServer(s.id)}
              mark={<ConnectorLogo server={s} />}
              name={c && s.name === c.id ? c.name : s.name}
              text={s.description || c?.description || (s.transport === "http" ? s.url : [s.command, ...s.args].join(" ")) || "Not set up yet"}
              warn={state.warn}
              meta={[state.text, users ? `${users} Sprocket${users === 1 ? "" : "s"}` : "No Sprocket yet"].filter(Boolean).join(" · ")}
              action={
                s.status.state === "ok" && s.signIn?.state !== "needed" ? (
                  <span className="cz-added" title="Connected" aria-label="Connected">
                    <Check size={16} aria-hidden />
                  </span>
                ) : undefined
              }
            />
          );
        })}
        {!query && <AddCard icon={<Plus size={20} />} title="Browse connectors" text="Linear, Notion, GitHub, Google Drive and more." onClick={onBrowse} />}
      </Section>
      {query && !shown.length && <p className="muted cz-none">None of yours match.</p>}
      {!query && <CustomSection onCustom={onCustom} />}
    </>
  );
}

function YourSkills({ skills, query, onNew, onBrowse }: { skills: Skill[]; query: string; onNew(): void; onBrowse(): void }) {
  const shown = skills.filter((s) => matches(query, s.name, s.description));
  return (
    <>
      <Section title="Your skills" count={skills.length} blurb="Instructions for a kind of work (a SKILL.md), which a Sprocket reads when it applies.">
        {shown.map((s) => (
          <Card
            key={s.id}
            href={href.skill(s.id)}
            mark={
              <span className="cz-logo" aria-hidden>
                <Book size={20} stroke={1.6} />
              </span>
            }
            name={s.name}
            text={s.description || "No description yet: say when to use it."}
            meta={[s.files.length ? `${s.files.length + 1} files` : "", s.usedBy.length ? `${s.usedBy.length} Sprocket${s.usedBy.length === 1 ? "" : "s"}` : "No Sprocket yet"]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
        {!query && <AddCard icon={<Plus size={20} />} title="New skill" text="Write the instructions yourself." onClick={onNew} />}
        {!query && <AddCard icon={<Book size={20} />} title="Copy one in" text="From your agents' skills, or a folder." onClick={onBrowse} />}
      </Section>
      {query && !shown.length && <p className="muted cz-none">None of yours match.</p>}
    </>
  );
}

/** Your agents' skills, by where they were found, to copy in; and a folder from the picker. */
function DiscoverSkills({ skills, query, onError }: { skills: Skill[]; query: string; onError(e: string): void }) {
  const [sources, setSources] = useState<SkillSource[] | null>(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    api.skillSources().then(setSources, (e) => onError(e.message));
  }, [onError]);
  const copy = async (path?: string) => {
    onError("");
    setBusy(path ?? "picker");
    try {
      const made = await api.importSkill(path);
      if (made) navigate(href.skill(made.id));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy("");
    }
  };
  const have = (s: SkillSource) => skills.find((k) => k.name === s.name || k.id === s.path.split("/").pop());
  const shown = useMemo(() => (sources ?? []).filter((s) => matches(query, s.name, s.description)), [sources, query]);
  const groups = [...new Set(shown.map((s) => s.from))];
  return (
    <>
      {sources === null && <p className="muted cz-none">Looking for your agents' skills…</p>}
      {groups.map((g) => (
        <Section key={g} title={g} count={shown.filter((s) => s.from === g).length} blurb="Rails copies it in, so changes here don't touch the original.">
          {shown
            .filter((s) => s.from === g)
            .map((s) => {
              const copied = have(s);
              return (
                <Card
                  key={s.path}
                  href={copied ? href.skill(copied.id) : undefined}
                  mark={
                    <span className="cz-logo" aria-hidden>
                      <Book size={20} stroke={1.6} />
                    </span>
                  }
                  name={s.name}
                  text={s.description || "No description."}
                  meta={copied ? "Copied in" : undefined}
                  action={
                    copied ? (
                      <span className="cz-added" title="Copied in" aria-label={`${s.name} is copied in`}>
                        <Check size={16} aria-hidden />
                      </span>
                    ) : (
                      <button type="button" className="icon-btn cz-plus" aria-label={`Copy in ${s.name}`} title={`Copy in ${s.name}`} disabled={!!busy} onClick={() => void copy(s.path)}>
                        {busy === s.path ? <span className="cz-spinner" aria-hidden /> : <Plus size={16} />}
                      </button>
                    )
                  }
                />
              );
            })}
        </Section>
      ))}
      {sources?.length === 0 && <p className="muted cz-none">None of your agents has skills in ~/.agents/skills, ~/.claude/skills or ~/.pi/agent/skills.</p>}
      {!query && (
        <Section title="From a folder">
          <AddCard
            icon={<FolderOpen size={20} />}
            title={busy === "picker" ? "Choose it in the window that opened…" : "Choose a folder…"}
            text="Any folder with a SKILL.md. The picker opens on the computer Rails runs on."
            onClick={() => void copy()}
          />
        </Section>
      )}
    </>
  );
}

function YourPrompts({ prompts, query, onNew }: { prompts: SavedPrompt[]; query: string; onNew(): void }) {
  const shown = prompts.filter((p) => matches(query, p.name, p.text));
  return (
    <>
      <Section title="Saved prompts" count={prompts.length} blurb="Messages you send often. Home and every chat can fill one in, and Sprockets can read them.">
        {shown.map((p) => (
          <Card
            key={p.id}
            href={href.prompt(p.id)}
            mark={
              <span className="cz-logo" aria-hidden>
                <Message size={20} stroke={1.6} />
              </span>
            }
            name={p.name}
            text={p.text || "Empty"}
          />
        ))}
        {!query && <AddCard icon={<Plus size={20} />} title="New prompt" text="A message to fill in from Home or a chat." onClick={onNew} />}
      </Section>
      {query && !shown.length && <p className="muted cz-none">None match.</p>}
    </>
  );
}
