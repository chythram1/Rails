import { useState, type ReactNode } from "react";
import {
  IconActivity as Activity,
  IconAlertCircle as AlertCircle,
  IconCircleCheck as CircleCheck,
  IconCircleDashed as CircleDashed,
  IconCircleX as CircleX,
  IconClock as Clock,
  IconDots as Dots,
  IconGauge as Gauge,
  IconLayoutDashboard as Dashboard,
  IconLoader2 as Loader,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconPlayerSkipForward as Skip,
  IconPlus as Plus,
  IconSearch as Search,
  IconSparkles as Sparkles,
  IconTemplate as Template,
} from "@tabler/icons-react";
import { AUTOMATION_RECENT, scheduleText, type Automation, type AutomationOutcome, type McpServer, type Sprocket as SprocketData } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type Route } from "../../router.ts";
import { timeAgo } from "../../util.ts";
import { useConfirm } from "../ConfirmDialog.tsx";
import { MenuButton } from "../Menu.tsx";
import { useModelSettings } from "../ModelSelect.tsx";
import { PageNav } from "../PageNav.tsx";
import { useStore } from "../../store.tsx";
import { Sprocket } from "../sprockets/Sprocket.tsx";
import { useSprockets } from "../sprockets/useSprockets.ts";
import { AutomationEditor } from "./AutomationEditor.tsx";
import { NewAutomation } from "./NewAutomation.tsx";
import { templateById } from "./templates.ts";
import { Templates } from "./Templates.tsx";
import { OUTCOME, soon, successRate, took, useAutomations } from "./useAutomations.ts";

type AutomateRoute = Extract<Route, { name: "automate" }>;

/**
 * Automate (ADR 0032): prompts a Sprocket runs on a schedule, with two tabs beside the page. The Dashboard says how
 * they're doing at a glance (an overview strip), then a card for each (On, then Off); Templates are starting points.
 * One opens full width in its place; a new one is a draft until Create, filled in from a template if it came from one.
 */
export function AutomatePage({ route }: { route: AutomateRoute }) {
  const { list: sprockets } = useSprockets();
  const { mcpServers } = useStore();
  if (route.view === "new")
    return (
      <div className="cz-detail">
        {sprockets && mcpServers && <NewAutomation key={route.template ?? ""} sprockets={sprockets} servers={mcpServers} template={templateById(route.template)} />}
      </div>
    );
  if (route.view === "item")
    return <div className="cz-detail">{sprockets && <AutomationEditor key={route.id} id={route.id} sprockets={sprockets} />}</div>;
  return <Gallery key={route.view} tab={route.view} sprockets={sprockets ?? []} servers={mcpServers ?? []} />;
}

const TABS = [
  { id: "list", label: "Dashboard", icon: <Dashboard size={18} stroke={1.6} />, href: href.automate(), lead: "How your automations are doing: what needs you, how their runs went, and what runs next." },
  {
    id: "templates",
    label: "Templates",
    icon: <Template size={18} stroke={1.6} />,
    href: href.automateTemplates(),
    lead: "Starting points to make your own. Each opens as a new automation to change before you create it.",
  },
] as const;

/** Whether its last run, or Rails pausing it, wants the user to look. */
const needsYou = (a: Automation) => !!a.pausedReason || a.lastRun?.outcome === "needs_you" || a.lastRun?.outcome === "failed";

function Gallery({ tab, sprockets, servers }: { tab: "list" | "templates"; sprockets: SprocketData[]; servers: McpServer[] }) {
  const { list, error } = useAutomations();
  const { settings: models } = useModelSettings();
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmDialog, ask] = useConfirm();
  const q = query.trim().toLowerCase();
  const sprocketOf = (a: Automation) => sprockets.find((s) => s.id === a.sprocketId);
  const modelOf = (s?: SprocketData) => {
    const ref = s?.model ?? models?.defaultModel;
    return ref ? (models?.models.find((m) => m.ref === ref)?.name ?? ref) : undefined;
  };
  const shown = (list ?? []).filter((a) => !q || [a.name, a.prompt, sprocketOf(a)?.name ?? ""].some((t) => t.toLowerCase().includes(q)));
  const on = shown.filter((a) => a.enabled);
  const off = shown.filter((a) => !a.enabled);

  const act = (a: Automation, what: () => Promise<unknown>) => async () => {
    setActionError("");
    try {
      await what();
    } catch (e: any) {
      setActionError(`${a.name}: ${e.message}`);
    }
  };
  const remove = (a: Automation) =>
    ask({
      title: `Delete ${a.name}?`,
      text: "It stops running. What its runs posted stays in the Sprocket's chat.",
      action: "Delete automation",
      danger: true,
      onConfirm: async () => {
        await api.deleteAutomation(a.id);
      },
    });
  const card = (a: Automation) => {
    const s = sprocketOf(a);
    return (
      <Card
        key={a.id}
        a={a}
        sprocket={s}
        model={modelOf(s)}
        onRun={act(a, () => api.runAutomation(a.id))}
        onToggle={act(a, () => api.updateAutomation(a.id, { enabled: !a.enabled }))}
        onDelete={() => remove(a)}
      />
    );
  };

  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="cz-page">
      {confirmDialog}
      <PageNav id="au" title="Automate" items={TABS.map((t) => ({ href: t.href, label: t.label, icon: t.icon, current: t.id === tab }))}>
        <div className="cz-head-row">
          <div>
            <h2 className="cz-title">{current.label}</h2>
            <p className="cz-lead">{current.lead}</p>
          </div>
          <a className="btn primary cz-add" href={href.newAutomation()}>
            <span className="cz-add-label">
              <Plus size={16} aria-hidden /> New automation
            </span>
          </a>
        </div>
        {tab === "list" && !!list?.length && <Overview list={list} />}
        {(tab === "templates" || !!list?.length) && (
          <label className="cz-search au-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              placeholder={tab === "templates" ? "Search templates" : "Search automations"}
              aria-label={tab === "templates" ? "Search templates" : "Search automations"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {tab === "templates" && <Templates query={query} servers={servers} sprockets={sprockets} />}
        {tab === "list" && (
          <>
            {(error || actionError) && (
              <p className="error au-error" role="alert">
                {error || actionError}
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
                  <li className="cz-card cz-card-add">
                    <button type="button" className="cz-card-add-btn" onClick={() => navigate(href.automateTemplates())}>
                      <span className="cz-logo cz-logo-add" aria-hidden>
                        <Template size={18} />
                      </span>
                      <span className="cz-card-text">
                        <span className="cz-card-name">Start from a template</span>
                        <span className="cz-card-desc">A morning brief of your agent sessions, Linear triage, new Sentry errors and more.</span>
                      </span>
                    </button>
                  </li>
                </ul>
              </section>
            )}
            {list && !!list.length && !shown.length && <p className="muted cz-none">Nothing matches “{query.trim()}”.</p>}
            {!!on.length && (
              <Section title="On" count={on.length}>
                {on.map(card)}
              </Section>
            )}
            {!!off.length && (
              <Section title="Off" count={off.length}>
                {off.map(card)}
              </Section>
            )}
          </>
        )}
      </PageNav>
    </div>
  );
}

/** Four numbers across every automation: how many (and on), what needs you, how runs went, and what runs next. */
function Overview({ list }: { list: Automation[] }) {
  const on = list.filter((a) => a.enabled);
  const waiting = list.filter(needsYou);
  const runs = list.reduce((n, a) => n + a.stats.runs, 0);
  const rate = successRate(
    list.reduce((n, a) => n + a.stats.ended, 0),
    list.reduce((n, a) => n + a.stats.failed, 0),
  );
  const next = on.filter((a) => a.nextRunAt).sort((x, y) => Date.parse(x.nextRunAt!) - Date.parse(y.nextRunAt!))[0];
  const why = (a: Automation) => (a.pausedReason ? `${a.name} is paused` : `${a.name}: ${OUTCOME[a.lastRun!.outcome].label.toLowerCase()}`);
  return (
    <ul className="au-overview" aria-label="Overview">
      <Stat label="Automations" icon={<Gauge size={16} />} value={list.length} note={`${on.length} on`} />
      <Stat
        label="Needs you"
        icon={<AlertCircle size={16} />}
        value={waiting.length}
        note={!waiting.length ? "Nothing waits for you" : waiting.length === 1 ? why(waiting[0]) : `${waiting.length} want a look`}
        tone={waiting.length ? "needed" : undefined}
      />
      <Stat label="Runs" icon={<Activity size={16} />} value={runs} note={rate ? `${rate} without failing` : "None yet"} />
      <Stat label="Next run" icon={<Clock size={16} />} value={next ? soon(next.nextRunAt!) : "None"} note={next ? next.name : "Nothing on is scheduled"} />
    </ul>
  );
}

function Stat({ label, icon, value, note, tone }: { label: string; icon: ReactNode; value: ReactNode; note: string; tone?: "needed" }) {
  return (
    <li className="au-stat">
      <span className="au-stat-label">
        {label}
        <span className={`au-stat-icon${tone ? ` ${tone}` : ""}`} aria-hidden>
          {icon}
        </span>
      </span>
      <span className="au-stat-value">{value}</span>
      <span className="au-stat-note">{note}</span>
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `au-sec-${title.toLowerCase()}`;
  return (
    <section className="cz-section" aria-labelledby={id}>
      <div className="cz-section-head">
        <h2 id={id}>
          {title}
          <span className="cz-count">{count}</span>
        </h2>
      </div>
      <ul className="cz-cards au-cards">{children}</ul>
    </section>
  );
}

const OUTCOME_ICON: Record<AutomationOutcome, ReactNode> = {
  running: <Loader size={16} />,
  done: <CircleCheck size={16} />,
  quiet: <CircleDashed size={16} />,
  needs_you: <AlertCircle size={16} />,
  failed: <CircleX size={16} />,
  skipped: <Skip size={16} />,
};

/**
 * A card: the name (a link over the card) with Run now and a menu, its instructions, what runs it and when with its
 * last runs as bars, how the last one went, and its numbers.
 */
function Card({
  a,
  sprocket,
  model,
  onRun,
  onToggle,
  onDelete,
}: {
  a: Automation;
  sprocket?: SprocketData;
  model?: string;
  onRun(): void;
  onToggle(): void;
  onDelete(): void;
}) {
  const last = a.lastRun;
  const running = last?.outcome === "running";
  const rate = successRate(a.stats.ended, a.stats.failed);
  return (
    <li className="cz-card au-card">
      <div className="au-card-head">
        <a className="cz-card-name au-card-name" href={href.automation(a.id)}>
          {a.name}
        </a>
        <div className="cz-card-action au-card-actions">
          <button type="button" className="icon-btn" aria-label={`Run ${a.name} now`} title={running ? "It's running now" : "Run now"} disabled={running} onClick={onRun}>
            <Play size={16} />
          </button>
          <MenuButton
            label={`${a.name} actions`}
            title="More"
            icon={<Dots size={16} />}
            align="right"
            items={[
              { label: a.enabled ? "Turn off" : "Turn on", onSelect: onToggle },
              { label: "Delete automation", danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </div>
      <p className="cz-card-desc">{a.prompt}</p>
      <div className="au-card-facts">
        <ul className="au-tags" aria-label="Runs with">
          <li className="au-tag">
            {sprocket ? <Sprocket look={sprocket.look} size={16} seed={sprocket.id} still /> : null}
            {sprocket?.name ?? "No Sprocket"}
          </li>
          <li className="au-tag">
            <Clock size={14} aria-hidden />
            {scheduleText(a.schedule)}
          </li>
          {model && (
            <li className="au-tag">
              <Sparkles size={14} aria-hidden />
              {model}
            </li>
          )}
        </ul>
        <RunBars recent={a.stats.recent} />
      </div>
      <LastRun a={a} />
      <dl className="au-numbers">
        <div>
          <dt>Runs</dt>
          <dd>{a.stats.runs}</dd>
        </div>
        <div>
          <dt>Success</dt>
          <dd>{rate ?? "–"}</dd>
        </div>
        <div>
          <dt>Avg time</dt>
          <dd>{a.stats.avgMs != null ? took(a.stats.avgMs) : "–"}</dd>
        </div>
        <div>
          <dt>Next run</dt>
          <dd>{a.enabled ? (a.nextRunAt ? soon(a.nextRunAt) : "Not again") : "Off"}</dd>
        </div>
      </dl>
    </li>
  );
}

/** How its last run went (or that Rails paused it), with its one line and when. */
function LastRun({ a }: { a: Automation }) {
  const last = a.lastRun;
  if (a.pausedReason)
    return (
      <p className="au-last-run" title={a.pausedReason}>
        <span className="au-tone needed" aria-hidden>
          <Pause size={16} />
        </span>
        <span className="au-last-run-label">Paused</span>
        <span className="au-last-run-summary">{a.pausedReason}</span>
      </p>
    );
  if (!last)
    return (
      <p className="au-last-run">
        <span className="au-tone idle" aria-hidden>
          <Clock size={16} />
        </span>
        <span className="au-last-run-summary">No runs yet. Run it now to see what it does.</span>
      </p>
    );
  return (
    <p className="au-last-run" title={last.summary}>
      <span className={`au-tone ${OUTCOME[last.outcome].tone}`} aria-hidden>
        {OUTCOME_ICON[last.outcome]}
      </span>
      <span className="au-last-run-label">{OUTCOME[last.outcome].label}</span>
      {last.summary && <span className="au-last-run-summary">{last.summary}</span>}
      <time className="au-last-run-time" dateTime={last.createdAt}>
        {last.outcome === "running" ? "now" : timeAgo(last.createdAt)}
      </time>
    </p>
  );
}

/** Its last runs as bars, oldest first, each in its outcome's color; empty slots until it has run that often. */
function RunBars({ recent }: { recent: AutomationOutcome[] }) {
  const counts = new Map<string, number>();
  for (const o of recent) counts.set(OUTCOME[o].label, (counts.get(OUTCOME[o].label) ?? 0) + 1);
  const label = recent.length
    ? `Last ${recent.length} ${recent.length === 1 ? "run" : "runs"}: ${[...counts].map(([l, n]) => `${n} ${l.toLowerCase()}`).join(", ")}`
    : "No runs yet";
  const empty = AUTOMATION_RECENT - recent.length;
  return (
    <span className="au-bars" role="img" aria-label={label} title={label}>
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} className="au-bar" />
      ))}
      {recent.map((o, i) => (
        <span key={i} className={`au-bar ${OUTCOME[o].tone}`} />
      ))}
    </span>
  );
}
