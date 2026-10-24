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
import { PageNav } from "../PageNav.tsx";
import { Segmented } from "../Segmented.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { isConnected, McpEditor, serverSummary } from "./McpEditor.tsx";
import { AppSetup } from "./AppSetup.tsx";
import { NewItem } from "./NewItem.tsx";
import { PromptEditor } from "./PromptEditor.tsx";
import { ConnectorDialog, CustomServerDialog } from "./ServerDialogs.tsx";
import { SkillEditor } from "./SkillEditor.tsx";

type CustomizeRoute = Extract<Route, { name: "customize" }>;
type Mode = "yours" | "discover";

/** The tabs, each with its icon and the line under its title. */
const TABS: { id: CustomizeTab; label: string; icon: React.ReactNode; lead: string }[] = [
  { id: "connectors", label: "Connectors", icon: <Plug size={18} stroke={1.6} />, lead: "MCP servers that let your Sprockets work with your tools and data: Linear, Notion, GitHub and more, or any server of your own." },
  { id: "skills", label: "Skills", icon: <Book size={18} stroke={1.6} />, lead: "Instructions for a kind of work (a SKILL.md), which a Sprocket reads when it applies." },
  { id: "prompts", label: "Prompts", icon: <Message size={18} stroke={1.6} />, lead: "Messages you send often. Home and every chat can fill one in, and Sprockets can read them." },
];

/** Yours or Discover per tab, kept while the app is open (coming back from an item lands where you were). */
const modes: Partial<Record<CustomizeTab, Mode>> = {};

/**
 * Customize (ADR 0025): what Sprockets can use, as a page of cards with its tabs beside it: connectors (MCP servers),
 * skills and saved prompts. Yours shows what's here, Discover what can be added (Rails' connectors, your agents'
 * skills). One item opens full width in its place, with a way back. A Sprocket picks its servers and skills in its
 * settings, under Tools.
 */
export function CustomizePage({ route }: { route: CustomizeRoute }) {
  const { mcpServers, mcpApps, skills, savedPrompts } = useStore();
  if (!mcpServers || !skills || !savedPrompts) return null;

  if (route.view === "app") {
    const app = mcpApps?.find((a) => a.id === route.app);
    return <div className="cz-detail">{app ? <AppSetup app={app} /> : null}</div>;
  }
  const toConnectors = () => navigate(href.customize("connectors"));
  // Adding a server is a dialog over the connectors: a connector of Rails', or a custom one.
  const connector = route.view === "connector" ? connectorById(route.id) : undefined;
  const custom = route.view === "new" && (route.draft === "http" || route.draft === "stdio") ? route.draft : undefined;
  if (route.view === "new" && !custom)
    return (
      <div className="cz-detail">
        <NewItem key={route.draft} draft={route.draft === "prompt" ? "prompt" : "skill"} />
      </div>
    );
  if (route.view !== "home" && !connector && !custom) {
    const server = route.view === "mcp" ? mcpServers.find((s) => s.id === route.id) : undefined;
    const skill = route.view === "skill" ? skills.find((s) => s.id === route.id) : undefined;
    const prompt = route.view === "prompt" ? savedPrompts.find((p) => p.id === route.id) : undefined;
    return (
      <div className="cz-detail">
        {server ? (
          <McpEditor key={server.id} server={server} />
        ) : skill ? (
          <SkillEditor key={skill.id} skill={skill} />
        ) : prompt ? (
          <PromptEditor key={prompt.id} prompt={prompt} />
        ) : (
          <div className="cz-gone">
            <p className="muted">This one doesn't exist anymore. It may have been deleted on another device.</p>
            <a href={href.customize(route.tab)}>Back to Customize</a>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      {/* A tab of its own (key), so its first frame already shows its own Yours or Discover, search and error. */}
      <Gallery key={route.tab} tab={route.tab} servers={mcpServers} skills={skills} prompts={savedPrompts} />
      {connector && <ConnectorDialog key={connector.id} connector={connector} added={mcpServers.filter((s) => s.connector === connector.id)} onClose={toConnectors} />}
      {custom && <CustomServerDialog key={custom} transport={custom} onClose={toConnectors} />}
    </>
  );
}

function Gallery({ tab, servers, skills, prompts }: { tab: CustomizeTab; servers: McpServer[]; skills: Skill[]; prompts: SavedPrompt[] }) {
  const has = tab === "connectors" ? servers.length : tab === "skills" ? skills.length : prompts.length;
  const [mode, setModeState] = useState<Mode>(modes[tab] ?? (has ? "yours" : "discover"));
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const setMode = (m: Mode) => {
    modes[tab] = m;
    setModeState(m);
  };
  // New ones open as drafts: nothing is created until their page's Create.
  const newServer = (transport: "http" | "stdio") => navigate(href.newItem(transport));
  const newSkill = () => navigate(href.newItem("skill"));
  const newPrompt = () => navigate(href.newItem("prompt"));
  const q = query.trim().toLowerCase();

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="cz-page">
      <PageNav id="cz" title="Customize" items={TABS.map((t) => ({ href: href.customize(t.id), label: t.label, icon: t.icon, current: t.id === tab }))}>
        <div className="cz-head-row">
          <div>
            <h2 className="cz-title">{current.label}</h2>
            <p className="cz-lead">{current.lead}</p>
          </div>
          {tab === "connectors" && (
            <MenuButton
              label="Add custom server"
              title="Add an MCP server that isn't in the list"
              plain
              className="btn cz-add"
              icon={<span className="cz-add-label">Add custom server</span>}
              align="right"
              items={[
                { label: "A server on the web, by its URL", icon: <Plug size={16} />, onSelect: () => void newServer("http") },
                { label: "A program on this computer", icon: <Terminal size={16} />, onSelect: () => void newServer("stdio") },
              ]}
            />
          )}
          {tab === "skills" && (
            <button type="button" className="btn cz-add" onClick={() => void newSkill()}>
              New skill
            </button>
          )}
          {tab === "prompts" && (
            <button type="button" className="btn cz-add" onClick={() => void newPrompt()}>
              New prompt
            </button>
          )}
        </div>
        <div className="cz-toolbar">
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
          <label className="cz-search">
            <Search size={16} aria-hidden />
            <input type="search" placeholder={`Search ${current.label.toLowerCase()}`} aria-label={`Search ${current.label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tab === "connectors" &&
          (mode === "discover" ? (
            <DiscoverConnectors servers={servers} query={q} onCustom={(t) => void newServer(t)} />
          ) : (
            <YourConnectors servers={servers} query={q} onBrowse={() => setMode("discover")} />
          ))}
        {tab === "skills" &&
          (mode === "discover" ? (
            <DiscoverSkills skills={skills} query={q} onError={setError} />
          ) : (
            <YourSkills skills={skills} query={q} onNew={() => void newSkill()} onBrowse={() => setMode("discover")} />
          ))}
        {tab === "prompts" && <YourPrompts prompts={prompts} query={q} onNew={() => void newPrompt()} />}
      </PageNav>
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
 * A card: a mark, the name (a link that covers the card) over one muted line of what it is and its facts, two lines on what it does, its command or address (`detail`, in mono), and at the top right
 * one action (a "+" or a check) that sits above the link.
 */
function Card(props: {
  href?: string;
  mark: React.ReactNode;
  name: string;
  kind?: string;
  text?: string;
  detail?: string;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="cz-card">
      {props.mark}
      <div className="cz-card-text">
        <span className="cz-card-title">
          {props.href ? (
            <a className="cz-card-name" href={props.href}>
              {props.name}
            </a>
          ) : (
            <span className="cz-card-name">{props.name}</span>
          )}
          {(props.kind || props.meta) && (
            <span className="cz-card-kind">
              {[
                props.kind,
                props.meta,
              ]
                .filter(Boolean)
                .flatMap((x, i) => (i ? [" · ", x] : [x]))}
            </span>
          )}
        </span>
        {props.text && <p className="cz-card-desc">{props.text}</p>}
        {props.detail && (
          <p className="cz-card-detail" title={props.detail}>
            {props.detail}
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

/** Rails' connectors, by group, then the custom ones. */
function DiscoverConnectors({ servers, query, onCustom }: { servers: McpServer[]; query: string; onCustom(t: "http" | "stdio"): void }) {
  const shown = CONNECTORS.filter((c) => matches(query, c.name, c.description, c.by));
  return (
    <>
      {CONNECTOR_GROUPS.map((g) => {
        const list = shown.filter((c) => c.group === g.id);
        if (!list.length) return null;
        return (
          <Section
            key={g.id}
            title={g.title}
            count={list.length}
            action={
              g.id === "google" ? (
                <a className="cz-section-link" href={href.mcpApp("google")}>
                  Your Google app
                </a>
              ) : undefined
            }
          >
            {list.map((c) => {
              // Added counts once it's connected: one still waiting on its sign-in offers "+" to finish connecting it.
              const added = servers.find((s) => s.connector === c.id && isConnected(s));
              return (
                <Card
                  key={c.id}
                  href={added ? href.mcpServer(added.id) : href.connector(c.id)}
                  mark={<ConnectorLogo id={c.id} />}
                  name={c.name}
                  kind={SETUP_LABEL[c.setup]}
                  text={c.description}
                  action={
                    added ? (
                      <span className="cz-added" title="Added" aria-label={`${c.name} is added`}>
                        <Check size={16} aria-hidden />
                      </span>
                    ) : (
                      <button type="button" className="icon-btn cz-plus" aria-label={`Add ${c.name}`} title={`Add ${c.name}`} onClick={() => navigate(href.connector(c.id))}>
                        <Plus size={16} />
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
    <Section title="Custom">
      <AddCard icon={<Plug size={20} />} title="A server on the web" text="Paste its URL (Streamable HTTP). Sign in or add a token after." onClick={() => onCustom("http")} />
      <AddCard icon={<Terminal size={20} />} title="A program on this computer" text="A command such as npx or uvx, with its arguments and keys." onClick={() => onCustom("stdio")} />
    </Section>
  );
}

/** What a server is like now, in a few words (in the muted line, like any other fact: no red on cards). */
function serverState(s: McpServer): string {
  const setup = connectorById(s.connector)?.setup;
  if (s.signIn?.authUrl) return "Signing in…";
  if (s.signIn?.state === "needed") return "Sign in again";
  // A connector that signs in, and hasn't yet: say what it needs instead of "not connected".
  if (s.signIn?.state !== "signed-in" && setup === "own-app" && !s.signIn?.clientId) return "Set up your app to sign in";
  // A connector is only kept once it's connected, so one not signed in now lost its sign-in.
  if (s.signIn?.state !== "signed-in" && (setup === "sign-in" || setup === "own-app")) return "Sign in again";
  if (s.status.state === "error") return "Can't connect";
  if (s.status.state === "unknown" && !s.toolsAt) return "Not connected yet";
  return s.toolsAt ? `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}` : serverSummary(s);
}

function YourConnectors({ servers, query, onBrowse }: { servers: McpServer[]; query: string; onBrowse(): void }) {
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
          return (
            <Card
              key={s.id}
              href={href.mcpServer(s.id)}
              mark={<ConnectorLogo server={s} />}
              name={c && s.name === c.id ? c.name : s.name}
              kind={state}
              text={s.description || c?.description}
              detail={c ? undefined : (s.transport === "http" ? s.url : [s.command, ...s.args].join(" ")) || "Not set up yet"}
              action={
                isConnected(s) ? (
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
    </>
  );
}

function YourSkills({ skills, query, onNew, onBrowse }: { skills: Skill[]; query: string; onNew(): void; onBrowse(): void }) {
  const shown = skills.filter((s) => matches(query, s.name, s.description));
  return (
    <>
      <Section title="Your skills" count={skills.length}>
        {shown.map((s) => (
          <Card
            key={s.id}
            href={href.skill(s.id)}
            mark={
              <span className="cz-logo cz-logo-soft" aria-hidden>
                <Book size={20} stroke={1.6} />
              </span>
            }
            name={s.name}
            kind={s.files.length ? `${s.files.length + 1} files` : undefined}
            text={s.description || "No description yet: say when to use it."}
            meta={s.usedBy.length ? `${s.usedBy.length} Sprocket${s.usedBy.length === 1 ? "" : "s"}` : "No Sprocket yet"}
          />
        ))}
        {!query && !skills.length && <AddCard icon={<Plus size={20} />} title="New skill" text="Write the instructions yourself." onClick={onNew} />}
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
                    <span className="cz-logo cz-logo-soft" aria-hidden>
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
      <Section title="Saved prompts" count={prompts.length}>
        {shown.map((p) => (
          <Card
            key={p.id}
            href={href.prompt(p.id)}
            mark={
              <span className="cz-logo cz-logo-soft" aria-hidden>
                <Message size={20} stroke={1.6} />
              </span>
            }
            name={p.name}
            text={p.text || "Empty"}
          />
        ))}
        {!query && !prompts.length && <AddCard icon={<Plus size={20} />} title="New prompt" text="A message to fill in from Home or a chat." onClick={onNew} />}
      </Section>
      {query && !shown.length && <p className="muted cz-none">None match.</p>}
    </>
  );
}
