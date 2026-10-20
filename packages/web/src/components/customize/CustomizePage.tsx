import { useMemo, useState } from "react";
import { IconMessage as Message, IconPlus as Plus, IconSearch as Search } from "@tabler/icons-react";
import type { AgentProfile, SavedPrompt } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { providerLabel } from "../../util.ts";
import { MenuButton } from "../Menu.tsx";
import { ProviderIcon } from "../ProviderIcon.tsx";
import { ProfileEditor, profileSummary } from "./ProfileEditor.tsx";
import { PromptEditor } from "./PromptEditor.tsx";

type CustomizeRoute = Extract<Route, { name: "customize" }>;

/**
 * Customize (ADR 0020): agent profiles (launch options Rails passes to an agent as flags) and saved prompts.
 * It's laid out like the Sprockets page: a searchable list beside the one being edited, and on small screens
 * only one of the two at a time (so it reuses that page's list and layout classes).
 */
export function CustomizePage({ route }: { route: CustomizeRoute }) {
  const { agentProfiles, savedPrompts, refreshCustomize } = useStore();
  const [error, setError] = useState("");
  if (!agentProfiles || !savedPrompts) return null;

  const create = async (kind: "profile" | "prompt") => {
    setError("");
    try {
      const made = kind === "profile" ? await api.createAgentProfile({ agent: "claude" }) : await api.createPrompt({});
      await refreshCustomize(); // so the editor has it when it opens
      navigate(kind === "profile" ? href.profile(made.id) : href.prompt(made.id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const profile = route.view === "profile" ? agentProfiles.find((p) => p.id === route.id) : undefined;
  const prompt = route.view === "prompt" ? savedPrompts.find((p) => p.id === route.id) : undefined;
  let main;
  if (profile) main = <ProfileEditor key={profile.id} profile={profile} />;
  else if (prompt) main = <PromptEditor key={prompt.id} prompt={prompt} />;
  else if (route.id) main = <p className="sp-placeholder muted">This one doesn't exist anymore. It may have been deleted on another device.</p>;
  else main = <Intro onCreate={(k) => void create(k)} error={error} />;

  return (
    <div className={"sprockets customize " + (route.view === "list" ? "at-list" : "at-detail")}>
      <CustomizeList profiles={agentProfiles} prompts={savedPrompts} activeId={route.id} onCreate={(k) => void create(k)} />
      <section className="sp-main">{main}</section>
    </div>
  );
}

/** The list column: a search field and a "+" for a new profile or prompt, then the two groups. */
function CustomizeList(props: { profiles: AgentProfile[]; prompts: SavedPrompt[]; activeId?: string; onCreate(kind: "profile" | "prompt"): void }) {
  const [query, setQuery] = useState("");
  const { profiles, prompts } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const has = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
    return {
      profiles: props.profiles.filter((p) => has(p.name, p.model, p.instructions)),
      prompts: props.prompts.filter((p) => has(p.name, p.text)),
    };
  }, [props.profiles, props.prompts, query]);
  const empty = !props.profiles.length && !props.prompts.length;

  return (
    <aside className="sp-list" aria-labelledby="cz-list-title">
      <h1 id="cz-list-title" className="sr-only">Customize</h1>
      <div className="sp-list-head">
        <label className="sp-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Search" aria-label="Search profiles and prompts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <MenuButton
          label="New"
          title="New profile or prompt"
          icon={<Plus size={18} />}
          align="right"
          items={[
            { label: "New profile", icon: <ProviderIcon provider="claude" />, shortcut: "p", onSelect: () => props.onCreate("profile") },
            { label: "New prompt", icon: <Message size={16} />, shortcut: "m", onSelect: () => props.onCreate("prompt") },
          ]}
        />
      </div>
      {empty ? (
        <p className="muted small pad">Profiles and prompts you make show up here.</p>
      ) : !profiles.length && !prompts.length ? (
        <p className="muted small pad">No matches</p>
      ) : (
        <div className="sp-groups">
          {profiles.length > 0 && (
            <section className="sp-group" aria-labelledby="cz-group-profiles">
              <h2 id="cz-group-profiles" className="sp-group-title">Agent profiles</h2>
              <ul className="sp-rows">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <a className="sp-row cz-row" href={href.profile(p.id)} title={p.name} aria-current={p.id === props.activeId ? "page" : undefined}>
                      <ProviderIcon provider={p.agent} />
                      <span className="sp-row-text">
                        <span className="sp-row-top">
                          <span className="sp-row-name truncate">{p.name}</span>
                          {p.isDefault && <span className="sp-row-role">Default</span>}
                        </span>
                        <span className="muted small truncate">{profileSummary(p)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {prompts.length > 0 && (
            <section className="sp-group" aria-labelledby="cz-group-prompts">
              <h2 id="cz-group-prompts" className="sp-group-title">Saved prompts</h2>
              <ul className="sp-rows">
                {prompts.map((p) => (
                  <li key={p.id}>
                    <a className="sp-row cz-row" href={href.prompt(p.id)} title={p.name} aria-current={p.id === props.activeId ? "page" : undefined}>
                      <Message size={16} className="cz-row-icon" aria-hidden />
                      <span className="sp-row-text">
                        <span className="sp-row-name truncate">{p.name}</span>
                        <span className="muted small truncate">{p.text || "Empty"}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

/** With nothing open: what the two kinds are for, and a button for each. */
function Intro({ onCreate, error }: { onCreate(kind: "profile" | "prompt"): void; error: string }) {
  return (
    <div className="sp-placeholder cz-intro">
      <h2 className="cz-intro-title">Customize</h2>
      <p className="muted">
        <strong className="cz-strong">Agent profiles</strong> start {providerLabel.claude} with the model, effort, permission mode, instructions and
        tools you choose. Pick one from a pane's + menu or on Home, or make one the default.
      </p>
      <p className="muted">
        <strong className="cz-strong">Saved prompts</strong> are messages you start agents with often. Home's composer fills one in for you.
      </p>
      <div className="cz-intro-actions">
        <button className="btn" onClick={() => onCreate("profile")}>New profile</button>
        <button className="btn" onClick={() => onCreate("prompt")}>New prompt</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
