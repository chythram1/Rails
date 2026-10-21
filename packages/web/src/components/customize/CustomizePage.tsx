import { useMemo, useState } from "react";
import { IconMessage as Message, IconPlus as Plus, IconSearch as Search } from "@tabler/icons-react";
import type { AgentProfile, SavedPrompt } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ProviderIcon } from "../ProviderIcon.tsx";
import { AgentProfileEditor } from "./AgentProfileEditor.tsx";
import { PromptEditor } from "./PromptEditor.tsx";

type Kind = "profile" | "prompt";

/**
 * Customize: agent profiles and saved prompts (ADR 0020), a list beside the open one's editor, laid out like the
 * Sprockets page. On small screens only one of the two shows at a time.
 */
export function CustomizePage({ route }: { route: Extract<Route, { name: "customize" }> }) {
  const { agentProfiles: list, savedPrompts: prompts, customizeError, refreshCustomize } = useStore();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const { id } = route;

  const create = async (kind: Kind) => {
    setCreating(true);
    setError("");
    try {
      const made = kind === "profile" ? await api.createAgentProfile() : await api.createPrompt();
      await refreshCustomize(); // so the editor finds it when the page changes
      navigate(kind === "profile" ? href.agentProfile(made.id) : href.savedPrompt(made.id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (!list || !prompts) return customizeError ? <p className="error pad" role="alert">{customizeError}</p> : null;

  const current = route.view === "profile" ? list.find((p) => p.id === id) : undefined;
  const prompt = route.view === "prompt" ? prompts.find((p) => p.id === id) : undefined;
  let main;
  if (current) {
    main = <AgentProfileEditor key={current.id} profile={current} />;
  } else if (prompt) {
    main = <PromptEditor key={prompt.id} prompt={prompt} />;
  } else if (id) {
    main = <p className="sp-placeholder muted">This one doesn't exist anymore. It may have been deleted on another device.</p>;
  } else {
    main = (
      <div className="sp-placeholder cz-intro">
        <p className="eyebrow">Customize</p>
        <h2 className="cz-intro-title">{list.length ? "Pick an agent profile" : "Agent profiles"}</h2>
        <p className="muted">
          An agent profile sets how an agent starts: its model, effort, instructions, tools, MCP servers and skills. Make one for each
          kind of work, like research, frontend or backend, then pick it from the + menu or on Home, or make one the default.
        </p>
        <p className="muted">A saved prompt is a message you often start agents with. Home's composer and Sprocket chats fill one in for you.</p>
        <div className="cz-actions">
          <button className="btn" disabled={creating} onClick={() => void create("profile")}>
            New agent profile
          </button>
          <button className="btn" disabled={creating} onClick={() => void create("prompt")}>
            New prompt
          </button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className={"customize " + (id ? "at-detail" : "at-list")}>
      <CustomizeList profiles={list} prompts={prompts} activeId={id} creating={creating} onCreate={(k) => void create(k)} />
      <section className="sp-main">{main}</section>
    </div>
  );
}

/** The list column: a search field, then the profiles and the prompts by name, each group with a row that makes a new one. */
function CustomizeList(props: { profiles: AgentProfile[]; prompts: SavedPrompt[]; activeId?: string; creating: boolean; onCreate(kind: Kind): void }) {
  const { profiles: list, prompts, activeId, creating, onCreate } = props;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const has = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const shown = useMemo(() => list.filter((p) => has(p.name, p.description)), [list, q]);
  const shownPrompts = useMemo(() => prompts.filter((p) => has(p.name, p.text)), [prompts, q]);
  return (
    <aside className="sp-list" aria-labelledby="cz-list-title">
      <h1 id="cz-list-title" className="sr-only">Agent profiles</h1>
      <div className="sp-list-head">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search agent profiles and prompts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="sp-groups">
        <h2 className="sp-group-title">Agent profiles</h2>
        {list.length === 0 ? (
          <p className="muted small cz-list-note">None yet. Make one for each kind of work, like research or frontend.</p>
        ) : shown.length === 0 ? (
          <p className="muted small cz-list-note">No agent profiles match “{query.trim()}”.</p>
        ) : (
          <ul className="sp-rows">
            {shown.map((p) => (
              <li key={p.id}>
                <a className="sp-row" href={href.agentProfile(p.id)} title={p.name} aria-current={p.id === activeId ? "page" : undefined}>
                  <span className="sp-new-icon" aria-hidden>
                    <ProviderIcon provider={p.provider} />
                  </span>
                  <span className="sp-row-text">
                    <span className="sp-row-top">
                      <span className="sp-row-name truncate">{p.name}</span>
                      {p.isDefault && <span className="cz-source">Default</span>}
                    </span>
                    <span className="muted small truncate">{p.description || summary(p)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="sp-row cz-new-row" disabled={creating} onClick={() => onCreate("profile")}>
          <span className="sp-new-icon" aria-hidden>
            <Plus size={18} />
          </span>
          New agent profile
        </button>

        <h2 className="sp-group-title cz-group-gap">Saved prompts</h2>
        {prompts.length === 0 ? (
          <p className="muted small cz-list-note">None yet. Save a message you often start agents with.</p>
        ) : shownPrompts.length === 0 ? (
          <p className="muted small cz-list-note">No prompts match “{query.trim()}”.</p>
        ) : (
          <ul className="sp-rows">
            {shownPrompts.map((p) => (
              <li key={p.id}>
                <a className="sp-row" href={href.savedPrompt(p.id)} title={p.name} aria-current={p.id === activeId ? "page" : undefined}>
                  <span className="sp-new-icon" aria-hidden>
                    <Message size={16} />
                  </span>
                  <span className="sp-row-text">
                    <span className="sp-row-name truncate">{p.name}</span>
                    <span className="muted small truncate">{p.text || "Empty"}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="sp-row cz-new-row" disabled={creating} onClick={() => onCreate("prompt")}>
          <span className="sp-new-icon" aria-hidden>
            <Plus size={18} />
          </span>
          New prompt
        </button>
      </div>
    </aside>
  );
}

/** A profile without a description is described by what it sets: "Opus · Plan · 3 skills". */
export function summary(p: AgentProfile): string {
  const parts: string[] = [];
  if (p.model) parts.push(p.model[0].toUpperCase() + p.model.slice(1));
  if (p.effort) parts.push(`${EFFORT_LABELS[p.effort]} effort`);
  if (p.permissionMode) parts.push(PERMISSION_LABELS[p.permissionMode]);
  if (p.skills.length) parts.push(p.skills.length === 1 ? "1 skill" : `${p.skills.length} skills`);
  if (p.mcpServers.length) parts.push(p.mcpServers.length === 1 ? "1 MCP server" : `${p.mcpServers.length} MCP servers`);
  return parts.join(" · ") || "Claude Code's defaults";
}

export const EFFORT_LABELS = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" } as const;

export const PERMISSION_LABELS = {
  manual: "Manual",
  acceptEdits: "Accept edits",
  auto: "Auto",
  plan: "Plan",
  dontAsk: "Don't ask",
  bypassPermissions: "Bypass permissions",
} as const;
