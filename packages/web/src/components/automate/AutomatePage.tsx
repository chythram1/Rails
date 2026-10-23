import { useState } from "react";
import { IconPlayerPlay as Play, IconPlus as Plus, IconSearch as Search } from "@tabler/icons-react";
import { scheduleText, type Automation, type Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { timeAgo } from "../../util.ts";
import { Sprocket } from "../sprockets/Sprocket.tsx";
import { useSprockets } from "../sprockets/useSprockets.ts";
import { AutomationEditor } from "./AutomationEditor.tsx";
import { NewAutomation } from "./NewAutomation.tsx";
import { OUTCOME, useAutomations } from "./useAutomations.ts";

type AutomateRoute = Extract<Route, { name: "automate" }>;

/**
 * Automate (ADR 0032): prompts a Sprocket runs on a schedule, as a page of cards (On, then Off), like Customize's.
 * One opens full width in its place; a new one is a draft until Create.
 */
export function AutomatePage({ route }: { route: AutomateRoute }) {
  const { list: sprockets } = useSprockets();
  if (route.view === "new")
    return <div className="cz-detail">{sprockets && <NewAutomation sprockets={sprockets} />}</div>;
  if (route.view === "item")
    return <div className="cz-detail">{sprockets && <AutomationEditor key={route.id} id={route.id} sprockets={sprockets} />}</div>;
  return <Gallery sprockets={sprockets ?? []} />;
}

function Gallery({ sprockets }: { sprockets: SprocketData[] }) {
  const { list, error } = useAutomations();
  const [query, setQuery] = useState("");
  const [runError, setRunError] = useState("");
  const q = query.trim().toLowerCase();
  const nameOf = (id: string) => sprockets.find((s) => s.id === id)?.name ?? "";
  const shown = (list ?? []).filter((a) => !q || [a.name, a.prompt, nameOf(a.sprocketId)].some((t) => t.toLowerCase().includes(q)));
  const on = shown.filter((a) => a.enabled);
  const off = shown.filter((a) => !a.enabled);
  const runNow = async (a: Automation) => {
    setRunError("");
    try {
      await api.runAutomation(a.id);
    } catch (e: any) {
      setRunError(`${a.name}: ${e.message}`);
    }
  };
  const card = (a: Automation) => <Card key={a.id} a={a} sprocket={sprockets.find((s) => s.id === a.sprocketId)} onRun={() => void runNow(a)} />;

  return (
    <div className="cz-page">
      <div className="cz-page-inner">
        <h1 className="cz-title">Automate</h1>
        <p className="cz-lead">Prompts your Sprockets run on a schedule, while Rails' server is on. Each run posts in the Sprocket's chat, and anything it wants to change waits there for you.</p>
        <div className="cz-toolbar">
          <span className="grow" />
          <label className="cz-search">
            <Search size={15} aria-hidden />
            <input type="search" placeholder="Search" aria-label="Search automations" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <a className="btn primary cz-add" href={href.newAutomation()}>
            <span className="cz-add-label">
              <Plus size={16} aria-hidden /> New automation
            </span>
          </a>
        </div>
        {(error || runError) && (
          <p className="error" role="alert">
            {error || runError}
          </p>
        )}
        {list && !list.length && (
          <section className="cz-section" aria-label="No automations yet">
            <ul className="cz-cards">
              <li className="cz-card cz-card-add">
                <button type="button" className="cz-card-add-btn" onClick={() => navigate(href.newAutomation())}>
                  <span className="cz-logo cz-logo-add" aria-hidden>
                    <Plus size={18} />
                  </span>
                  <span className="cz-card-text">
                    <span className="cz-card-name">New automation</span>
                    <span className="cz-card-desc">Pick a Sprocket, say what it should do, and when. For example, every weekday at 9: “Tell me what changed in Linear since yesterday.”</span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        )}
        {list && !!list.length && !shown.length && <p className="muted cz-none">Nothing matches “{query.trim()}”.</p>}
        {!!on.length && <Section title="On" count={on.length}>{on.map(card)}</Section>}
        {!!off.length && <Section title="Off" count={off.length}>{off.map(card)}</Section>}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const id = `au-sec-${title.toLowerCase()}`;
  return (
    <section className="cz-section" aria-labelledby={id}>
      <div className="cz-section-head">
        <h2 id={id}>
          {title}
          <span className="cz-count">{count}</span>
        </h2>
      </div>
      <ul className="cz-cards">{children}</ul>
    </section>
  );
}

/** A card: its Sprocket's face, the name (a link over the card), its prompt, then when it runs and how it last went. */
function Card({ a, sprocket, onRun }: { a: Automation; sprocket?: SprocketData; onRun(): void }) {
  const last = a.lastRun;
  const running = last?.outcome === "running";
  return (
    <li className="cz-card">
      <span className="cz-logo au-face" aria-hidden>
        {sprocket && <Sprocket look={sprocket.look} size={30} seed={sprocket.id} still />}
      </span>
      <div className="cz-card-text">
        <a className="cz-card-name" href={href.automation(a.id)}>
          {a.name}
        </a>
        <p className="cz-card-desc">{a.prompt}</p>
        <p className="cz-card-meta">
          {a.pausedReason && <span className="cz-card-warn">Paused · </span>}
          {sprocket?.name ?? "No Sprocket"} · <span className="au-last">{scheduleText(a.schedule)}</span>
          {last && (
            <span className="au-last">
              {" · "}
              <span className={`cz-dot ${OUTCOME[last.outcome].tone}`} aria-hidden /> {OUTCOME[last.outcome].label} {last.outcome !== "running" && timeAgo(last.createdAt)}
            </span>
          )}
        </p>
      </div>
      <div className="cz-card-action">
        <button type="button" className="icon-btn cz-plus" aria-label={`Run ${a.name} now`} title={running ? "It's running now" : "Run now"} disabled={running} onClick={onRun}>
          <Play size={16} />
        </button>
      </div>
    </li>
  );
}
