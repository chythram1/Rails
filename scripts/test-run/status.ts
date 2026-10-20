// What's going on in a run, as one report: each agent's last event and the end of its screen, drafts waiting for
// the user, what the Sprocket said since the last look, handoffs and owners, and what needs the user now.
// `watch` repeats it until something needs the user.
import { openDb, all, lastEvents, sessionsOf } from "./db.ts";
import { Panes } from "./panes.ts";
import { saveState, type RunState } from "./run.ts";

const IDLE = new Set(["turn_end", "stopped", "failed", "ended", "start"]);
/** Signs on an agent's screen that it waits for the user in a way Rails may not report. */
const ASKING = /Do you want to|Approve (edit|shell|write)|Allow this|⇧← to answer|Trust this folder/;
const BUSY = /esc to interrupt|Working \(|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/;
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
const oneLine = (s: string, n: number) => (s.replace(/\s+/g, " ").length > n ? s.replace(/\s+/g, " ").slice(0, n - 1) + "…" : s.replace(/\s+/g, " "));

export interface Status {
  /** The agents, the drafts. */
  top: string[];
  /** New Sprocket messages, as lines. */
  news: string[];
  /** Handoffs and owners. */
  bottom: string[];
  /** What needs the user now (empty: nothing). */
  attention: string[];
}

/** A status as text, with the news given (watch passes everything since it started). */
export function render(s: Status, news = s.news, sprocket = "the Sprocket"): string {
  return [...s.top, `-- new from ${sprocket}`, ...news, ...s.bottom, `-- needs you: ${s.attention.join("; ") || "nothing"}`].join("\n");
}

export function status(state: RunState, { lines = 4, advance = true } = {}): Status {
  const { home } = state.config.rails;
  const db = openDb(home);
  const panes = new Panes(home);
  try {
    const out: string[] = [`== ${clock(new Date().toISOString())}  run ${state.config.name}`];
    const attention: string[] = [];
    const last = lastEvents(db, Object.values(state.panels).map((p) => p.id));
    let idle = 0;
    for (const agent of state.config.agents) {
      const panel = state.panels[agent.name];
      if (!panel) continue;
      const kind = last.get(panel.id) ?? "none";
      const screen = panes.screen(panel.id);
      const tail = screen.split("\n").filter((l) => !/^[─━\s]*$/.test(l)).slice(-lines);
      out.push(`-- ${agent.name} (${agent.kind}${agent.model ? `, ${agent.model}` : ""}): last event ${kind}`, ...tail.map((l) => `   ${l.slice(0, 150)}`));
      if (kind === "waiting") attention.push(`${agent.name} waits for you in its panel`);
      else if (ASKING.test(screen.split("\n").slice(-12).join("\n"))) attention.push(`${agent.name} may be asking something on its screen`);
      if (IDLE.has(kind) && !BUSY.test(tail.join("\n"))) idle++;
    }
    if (idle === state.config.agents.length) attention.push("every agent is idle");

    const drafts = all<{ id: string; mode: string; title: string; text: string; attachment: string | null }>(
      db,
      "SELECT id, mode, title, text, attachment FROM suggestions WHERE sprocket_id = ? AND status = 'pending' AND message_id IS NOT NULL ORDER BY created_at",
      state.sprocketId ?? "",
    );
    out.push("-- drafts waiting for you");
    for (const d of drafts) out.push(`   ${d.id.slice(0, 8)} [${d.mode}] for ${oneLine(d.title, 30)}: ${oneLine(d.text, 160)}${d.attachment ? " (+ the agent's own words)" : ""}`);
    if (drafts.length) attention.push(`${drafts.length} draft${drafts.length > 1 ? "s" : ""} to send, edit or dismiss`);

    const messages = all<{ created_at: string; author: string; what: string | null; quiet: number | null; text: string; activity: string | null }>(
      db,
      "SELECT created_at, author, json_extract(event, '$.what') AS what, json_extract(event, '$.quiet') AS quiet, text, activity FROM sprocket_messages WHERE sprocket_id = ? AND created_at > ? ORDER BY created_at",
      state.sprocketId ?? "",
      state.seen,
    );
    const news = messages.map(
      (m) =>
        `   ${clock(m.created_at)} ${m.author}${m.what ? ` <${m.what}${m.quiet ? ", quiet" : ""}>` : ""}${m.activity ? ` [${m.activity}]` : ""}: ${oneLine(m.text, 220)}`,
    );
    if (messages.some((m) => m.author !== "user")) attention.push(`${state.config.sprocket.name} said something`);

    const handoffs = all<{ from_title: string; to_title: string }>(db, "SELECT from_title, to_title FROM handoffs WHERE sprocket_id = ? AND status = 'pending'", state.sprocketId ?? "");
    const owners = all<{ panel_id: string; paths: string }>(db, "SELECT panel_id, group_concat(path, ', ') AS paths FROM owners WHERE project_id = ? GROUP BY panel_id", state.projectId ?? "");
    const nameOf = (panelId: string) => Object.entries(state.panels).find(([, p]) => p.id === panelId)?.[0] ?? panelId.slice(0, 8);
    const bottom = [
      `-- handoffs waiting: ${handoffs.map((h) => `${oneLine(h.from_title, 20)} → ${oneLine(h.to_title, 20)}`).join("; ") || "none"}`,
      `-- owners: ${owners.map((o) => `${nameOf(o.panel_id)}: ${o.paths}`).join("; ") || "none"}`,
    ];

    // Note the agents' sessions as they go: Rails keeps only a panel's latest events, and cleanup needs them all.
    const sessions = { ...state.sessions, ...sessionsOf(db, Object.values(state.panels)) } as RunState["sessions"];
    const newSession = Object.keys(sessions!).length !== Object.keys(state.sessions ?? {}).length;
    if (newSession) state.sessions = sessions;
    if (advance && messages.length) state.seen = messages.at(-1)!.created_at;
    if (newSession || (advance && messages.length)) saveState(state);
    return { top: out, news, bottom, attention };
  } finally {
    db.close();
  }
}

/**
 * Look every 10 s until something needs the user, or `maxSec` passes. Every agent being idle only counts after
 * the first 15 s (a prompt just typed hasn't reached Rails yet). Prints the last look and everything new.
 */
export async function watch(state: RunState, maxSec: number): Promise<string> {
  const started = Date.now();
  const news: string[] = [];
  for (;;) {
    const s = status(state);
    news.push(...s.news);
    const now = Date.now();
    s.attention = s.attention.filter((a) => a !== "every agent is idle" || now - started > 15_000);
    if (s.attention.length || now - started >= maxSec * 1000) return render(s, news, state.config.sprocket.name);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
