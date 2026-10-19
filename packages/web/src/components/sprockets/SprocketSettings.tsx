import { useEffect, useRef, useState } from "react";
import { IconArrowRight as ArrowRight, IconChevronLeft as ChevronLeft, IconLayoutSidebarRight as PanelRight, IconSettings as Cog, IconX as X } from "@tabler/icons-react";
import {
  SPROCKET_DESCRIPTION_MAX,
  SPROCKET_RULE_MAX,
  SPROCKET_RULES_MAX,
  type Sprocket as SprocketData,
  type SprocketSettings as Settings,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { shortTitle } from "../../util.ts";
import { Dropdown } from "../Dropdown.tsx";
import { PanelIcon } from "../PanelMenu.tsx";
import { ModelSelect, useModelSettings } from "../ModelSelect.tsx";
import { useOpenSettings } from "../settings/context.ts";
import { useAutoGrow } from "../useAutoGrow.ts";

/**
 * The button that opens and closes a Sprocket's settings panel. It sits at the right end of the chat header,
 * and at the panel's own top right while the panel is open (ref/sprockets/stage2/chat2.png), so it never moves
 * from under the pointer's corner and the panel needs no title or close button of its own.
 */
export function PanelToggle({ sprocket, open }: { sprocket: SprocketData; open: boolean }) {
  return (
    <a
      className={"icon-btn sp-panel-toggle" + (open ? " active" : "")}
      href={open ? href.sprocket(sprocket.id) : href.sprocketSettings(sprocket.id)}
      aria-label={`${sprocket.name} settings`}
      aria-expanded={open}
      title={open ? "Close settings" : "Settings"}
    >
      <PanelRight size={18} />
    </a>
  );
}

/**
 * A Sprocket's panel beside its chat (refs: ref/sprockets/stage2/chat2.png, settings1.png and settings2.png,
 * Grok's). It opens on the Sprocket's job: the project it looks after (one Sprocket per project, ADR 0016), its
 * standing rules and its pending handoffs. A cog at the top right leads to Settings, what rarely changes (name,
 * description, model, Delete), which has a back arrow at its top left. Everything saves as you go: a field
 * when you leave it, a choice at once, and a quiet "Saved" in the header confirms it. Its core memory is its
 * own business. Moving it to another project deletes its chat there, so that asks first. The panel has its
 * own URL (`#/sprockets/<id>/settings`): its toggle, Escape (from Settings: back first) or the browser's back
 * button close it.
 */
export function SprocketSettings({ sprocket, all }: { sprocket: SprocketData; all: SprocketData[] }) {
  const { id, name } = sprocket;
  const { projects } = useStore();
  const project = projects.find((p) => p.id === sprocket.projectId);
  // A project has one Sprocket (ADR 0016): projects another one looks after can't be picked.
  const holderOf = (projectId: string) => all.find((s) => s.projectId === projectId && s.id !== id);
  const { settings: models } = useModelSettings();
  const openSettings = useOpenSettings();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  const [page, setPage] = useState<"job" | "settings">("job");
  const close = () => navigate(href.sprocket(id));
  // Changing pages puts focus where the page starts: the back arrow on Settings, the cog back on the job.
  const pageStart = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current) pageStart.current?.focus();
  }, [page]);
  const go = (to: "job" | "settings") => {
    moved.current = true;
    setPage(to);
  };

  // "Saved" shows for a moment after each save.
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 2000);
    return () => clearTimeout(t);
  }, [saved]);
  const done = (ok: boolean, message = "") => {
    setError(message);
    if (ok) setSaved(Date.now());
    return ok;
  };
  const save = async (body: Settings) => {
    try {
      await api.sprocketSettings(id, body);
      return done(true);
    } catch (e: any) {
      return done(false, e.message);
    }
  };

  const move = async (projectId: string) => {
    const to = projects.find((p) => p.id === projectId);
    const question = to ? `Attach ${name} to ${to.name}?` : `Detach ${name} from its project?`;
    if (sprocket.lastMessage && !confirm(`${question}\n\nIts chat is deleted. Its name, look and core memory stay.`)) return;
    await save({ projectId: projectId || null });
  };

  const remove = async () => {
    if (!confirm(`Delete ${name}?\n\nIts chat and memory are deleted too. This can't be undone.`)) return;
    try {
      await api.deleteSprocket(id);
      navigate(href.sprockets());
    } catch (e: any) {
      done(false, e.message);
    }
  };

  const defaultName = models?.models.find((m) => m.ref === models.defaultModel)?.name;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (page === "settings") go("job");
    else close();
  };

  return (
    <aside className="sp-panel" aria-labelledby="sp-panel-title" onKeyDown={onKey}>
      <header className="sp-panel-head">
        <div className="sp-panel-start">
          {page === "settings" ? (
            <button ref={pageStart} className="icon-btn" aria-label={`Back to ${name}`} title="Back" onClick={() => go("job")}>
              <ChevronLeft size={18} />
            </button>
          ) : (
            <button className="icon-btn sp-panel-back" aria-label={`Back to the chat with ${name}`} onClick={close}>
              <ChevronLeft size={18} />
            </button>
          )}
        </div>
        {/* The job page needs no title (the chat beside it says whose it is); screen readers still get one. */}
        <h2 id="sp-panel-title" className={page === "settings" ? "sp-panel-title" : "sr-only"}>
          {page === "settings" ? "Settings" : `${name} settings`}
        </h2>
        <div className="sp-panel-end">
          <span className="sp-saved muted small" role="status">{saved ? "Saved" : ""}</span>
          {page === "job" && (
            <button ref={pageStart} className="icon-btn" aria-label={`${name}'s name, description and model`} title="Settings" onClick={() => go("settings")}>
              <Cog size={18} />
            </button>
          )}
          <PanelToggle sprocket={sprocket} open />
        </div>
      </header>
      <div className="sp-panel-body">
        {page === "job" ? (
          <section className="sp-section" aria-label="Project">
            <div className="settings-field">
              <label htmlFor="sp-project">Project</label>
              <Dropdown
                id="sp-project"
                value={sprocket.projectId ?? ""}
                disabled={sprocket.running}
                options={[
                  { value: "", label: "None" },
                  ...projects.map((p) => {
                    const holder = holderOf(p.id);
                    return { value: p.id, label: holder ? `${p.name} (${holder.name})` : p.name, disabled: !!holder };
                  }),
                ]}
                describedBy="sp-project-help"
                onChange={(v) => void move(v)}
              />
              <p id="sp-project-help" className="muted small">
                {sprocket.running
                  ? "It's replying. You can move it when it's done."
                  : project
                    ? "It looks after this project's sessions: it tells you when one waits for you, passes things on and watches for clashes."
                    : "Attach it to a project to have it look after that project's sessions. A project has one Sprocket."}
              </p>
            </div>
            {sprocket.coordinator && <RulesField sprocket={sprocket} onSave={(rules) => save({ rules })} />}
            {sprocket.coordinator && <HandoffsField sprocket={sprocket} />}
            {sprocket.projectId && <OwnersField sprocket={sprocket} />}
          </section>
        ) : (
          <>
            <section className="sp-section" aria-label="About">
              <NameField sprocket={sprocket} onDone={done} />
              <DescriptionField sprocket={sprocket} onSave={(description) => save({ description })} />
              <div className="settings-field">
                <label htmlFor="sp-model">Model</label>
                {models && (
                  <ModelSelect
                    id="sp-model"
                    settings={models}
                    value={sprocket.model}
                    empty={defaultName ? `Default (${defaultName})` : "Default (none set)"}
                    onChange={(ref) => void save({ model: ref })}
                  />
                )}
                {models && !models.models.length && (
                  <p className="muted small">
                    No models yet.{" "}
                    <button type="button" className="link" onClick={() => openSettings("providers")}>
                      Connect a provider
                    </button>
                  </p>
                )}
              </div>
              <div className="settings-field">
                <p className="sp-field-label">Usage</p>
                <p className="muted small">{usageText(sprocket.usage)}</p>
              </div>
            </section>

            {/* For now Delete lives here, at the end, set apart from what you change often. */}
            <div className="sp-danger-zone">
              <button type="button" className="btn small danger" onClick={() => void remove()}>
                Delete {name}
              </button>
            </div>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}

/** The name, saved when the field loses focus (or on Enter); Escape puts it back. */
function NameField({ sprocket, onDone }: { sprocket: SprocketData; onDone(ok: boolean, message?: string): boolean }) {
  const [value, setValue] = useState(sprocket.name);
  useEffect(() => setValue(sprocket.name), [sprocket.name]);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === sprocket.name) return setValue(sprocket.name);
    try {
      await api.updateSprocket(sprocket.id, { name: next, look: sprocket.look });
      onDone(true);
    } catch (e: any) {
      onDone(false, e.message);
      setValue(sprocket.name);
    }
  };
  return (
    <div className="settings-field">
      <label htmlFor="sp-name">Name</label>
      <input
        id="sp-name"
        className="input"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && value !== sprocket.name) {
            e.stopPropagation(); // put it back; a second Escape closes the panel
            setValue(sprocket.name);
          }
        }}
      />
    </div>
  );
}

/**
 * A Coordinator's standing rules (ADR 0011): one plain sentence each, numbered as the Sprocket reads them.
 * An edited rule is saved when its field loses focus (Enter does that too: rules are one line of thought);
 * a new one is added with Enter or Add, and removing one saves at once.
 */
function RulesField({ sprocket, onSave }: { sprocket: SprocketData; onSave(rules: string[]): Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const draftRef = useAutoGrow(draft);
  const full = sprocket.rules.length >= SPROCKET_RULES_MAX;
  const add = async () => {
    const rule = draft.trim();
    if (rule && !full && (await onSave([...sprocket.rules, rule]))) setDraft("");
  };
  return (
    <div className="settings-field sp-rules" role="group" aria-labelledby="sp-rules-label">
      <p id="sp-rules-label" className="sp-field-label">Rules</p>
      <p className="muted small">How it answers sessions, one sentence each.</p>
      {sprocket.rules.length > 0 && (
        <ol className="sp-rules-list">
          {sprocket.rules.map((rule, i) => (
            <RuleRow
              key={`${i}:${rule}`}
              n={i + 1}
              rule={rule}
              onSave={(next) => onSave(sprocket.rules.map((r, j) => (j === i ? next : r)).filter((r) => r.trim()))}
              onRemove={() => onSave(sprocket.rules.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      {full ? (
        <p className="muted small">That's {SPROCKET_RULES_MAX} rules, the most a Sprocket can have.</p>
      ) : (
        <form
          className="sp-rule-add"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <textarea
            ref={draftRef}
            className="input"
            rows={1}
            aria-label="New rule"
            maxLength={SPROCKET_RULE_MAX}
            placeholder={sprocket.rules.length ? "Add a rule" : "e.g. “If it asks whether to continue with its plan, say yes.”"}
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          {draft.trim() && (
            <div className="sp-field-foot">
              <span className="muted small">{draft.length} / {SPROCKET_RULE_MAX}</span>
              <span className="grow" />
              <button type="button" className="btn small" onClick={() => setDraft("")}>Cancel</button>
              <button className="btn small primary">Add</button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/** One rule, editable in place. Emptying it removes it; Escape puts it back. */
function RuleRow({ n, rule, onSave, onRemove }: { n: number; rule: string; onSave(next: string): Promise<boolean>; onRemove(): void }) {
  const [text, setText] = useState(rule);
  const ref = useAutoGrow(text);
  const commit = () => {
    if (text.trim() === rule) return setText(rule);
    void onSave(text).then((ok) => ok || setText(rule));
  };
  return (
    <li className="sp-rule">
      <span className="sp-rule-n" aria-hidden>{n}</span>
      <textarea
        ref={ref}
        className="sp-rule-text"
        rows={1}
        aria-label={`Rule ${n}`}
        maxLength={SPROCKET_RULE_MAX}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.stopPropagation(); // don't close the panel
            setText(rule);
          }
        }}
      />
      <button type="button" className="icon-btn sp-rule-remove" aria-label={`Remove rule ${n}`} title="Remove" onClick={onRemove}>
        <X size={14} />
      </button>
    </li>
  );
}

/** What a Sprocket's runs have used: "No replies yet.", or "12 replies · 312,400 tokens · $0.04". */
function usageText({ runs, tokens, cost }: SprocketData["usage"]): string {
  if (!runs) return "No replies yet.";
  const parts = [`${runs.toLocaleString()} ${runs === 1 ? "reply" : "replies"}`, `${tokens.toLocaleString()} tokens`];
  if (cost > 0) parts.push(cost < 0.01 ? "under $0.01" : `$${cost.toFixed(2)}`);
  return parts.join(" \u00b7 ");
}

/**
 * Who owns what in the Sprocket's project (ADR 0016): set by telling it in the chat, each removable here. The
 * session's own title when the sidebar knows it, else its panel's.
 */
function OwnersField({ sprocket }: { sprocket: SprocketData }) {
  const { sessions } = useStore();
  const [error, setError] = useState("");
  const titleOf = (o: SprocketData["owners"][number]) => sessions[sprocket.projectId!]?.find((s) => s.panelId === o.panelId)?.title || o.title;
  const clear = async (panelId: string) => {
    setError("");
    try {
      await api.clearOwner(panelId);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <div className="settings-field" role="group" aria-labelledby="sp-owners-label">
      <p id="sp-owners-label" className="sp-field-label">Owners</p>
      <p className="muted small">
        {sprocket.owners.length
          ? "Who owns which files. It sends requests to their owner and tells you when another session changes them."
          : `None yet. Tell ${sprocket.name} in the chat, e.g. \u201cClaude owns src/engine and index.html.\u201d`}
      </p>
      {sprocket.owners.length > 0 && (
        <ul className="sp-handoffs">
          {sprocket.owners.map((o) => (
            <li key={o.panelId} className="sp-handoff">
              <div className="sp-handoff-text">
                <p className="sp-handoff-route">
                  <PanelIcon kind={o.kind} />
                  <span className="truncate" title={titleOf(o)}>{shortTitle(titleOf(o))}</span>
                </p>
                <p className="sp-owner-paths">{o.paths.join(", ")}</p>
              </div>
              <button type="button" className="icon-btn sp-rule-remove" aria-label={`Remove what ${titleOf(o)} owns`} title="Remove" onClick={() => void clear(o.panelId)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * A Coordinator's pending handoffs (ADR 0015): what it passes on when a session finishes, each with Cancel.
 * They're planned in the chat ("When the auth session is done, tell the UI session to …").
 */
function HandoffsField({ sprocket }: { sprocket: SprocketData }) {
  const [error, setError] = useState("");
  const cancel = async (id: string) => {
    setError("");
    try {
      await api.cancelHandoff(id);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <div className="settings-field" role="group" aria-labelledby="sp-handoffs-label">
      <p id="sp-handoffs-label" className="sp-field-label">Handoffs</p>
      <p className="muted small">
        {sprocket.handoffs.length
          ? "What it passes on when a session finishes."
          : `None waiting. Ask ${sprocket.name} in the chat, e.g. “When the auth session is done, tell the UI session to use the new endpoint.”`}
      </p>
      {sprocket.handoffs.length > 0 && (
        <ul className="sp-handoffs">
          {sprocket.handoffs.map((h) => (
            <li key={h.id} className="sp-handoff">
              <div className="sp-handoff-text">
                <p className="sp-handoff-route">
                  <span className="sr-only">When </span>
                  <PanelIcon kind={h.from.kind} />
                  <span className="truncate" title={h.from.title}>{shortTitle(h.from.title)}</span>
                  <span className="sr-only"> finishes, to </span>
                  <ArrowRight size={13} className="sp-handoff-arrow" aria-hidden />
                  <PanelIcon kind={h.to.kind} />
                  <span className="truncate" title={h.to.title}>{shortTitle(h.to.title)}</span>
                </p>
                <p className="sp-handoff-note">{h.note}</p>
              </div>
              <button type="button" className="icon-btn sp-rule-remove" aria-label={`Cancel the handoff to ${h.to.title}`} title="Cancel" onClick={() => void cancel(h.id)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The description: what the user wants from this Sprocket, in a few sentences. It's its standing
 * instructions, a small AGENTS.md that goes into every run, and it stays with it across projects. Saved when
 * the field loses focus, like the name; Escape puts it back.
 */
function DescriptionField({ sprocket, onSave }: { sprocket: SprocketData; onSave(text: string): Promise<boolean> }) {
  const [text, setText] = useState(sprocket.description);
  const [editing, setEditing] = useState(false);
  const reverting = useRef(false);
  const ref = useAutoGrow(text);
  useEffect(() => {
    if (!editing) setText(sprocket.description);
  }, [sprocket.description, editing]);
  const commit = async () => {
    setEditing(false);
    if (reverting.current) return void (reverting.current = false);
    if (text.trim() !== sprocket.description && !(await onSave(text))) setText(sprocket.description);
  };
  return (
    <div className="settings-field">
      <label htmlFor="sp-description">Description</label>
      <textarea
        ref={ref}
        id="sp-description"
        className="input sp-grow"
        rows={2}
        maxLength={SPROCKET_DESCRIPTION_MAX}
        placeholder="What it's for and how it should work, e.g. “Keep an eye on the PRs in this project and tell me what looks risky.”"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text !== sprocket.description) {
            e.stopPropagation(); // put it back; a second Escape closes the panel
            reverting.current = true;
            setText(sprocket.description);
            e.currentTarget.blur();
          }
        }}
        aria-describedby="sp-description-help"
      />
      <p id="sp-description-help" className="muted small">
        It follows this in every reply{editing ? ` (${text.length}/${SPROCKET_DESCRIPTION_MAX})` : ""}.
      </p>
    </div>
  );
}
