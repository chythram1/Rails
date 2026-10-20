// A run's numbers, as markdown: what the Sprocket did (events, drafts and what became of them, handoffs, owners,
// usage), what the decision model judged, what each agent did, what the person running it did (the log), and the
// project it built. Compare two runs by their reports.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, one, openDb } from "./db.ts";
import { readLog, runDir, type RunState } from "./run.ts";

const minutes = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
const git = (cwd: string, ...args: string[]) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

export function report(state: RunState): string {
  const { config } = state;
  const db = openDb(config.rails.home);
  const sid = state.sprocketId ?? "";
  const ended = state.endedAt ?? new Date().toISOString();
  const entries = readLog(state);
  const out: string[] = [];
  const line = (s = "") => out.push(s);
  const table = (head: string[], rows: (string | number)[][]) => {
    line(`| ${head.join(" | ")} |`);
    line(`|${head.map(() => " --- ").join("|")}|`);
    for (const r of rows) line(`| ${r.join(" | ")} |`);
    line();
  };
  try {
    line(`# Test run: ${config.name}`);
    line();
    line(`${new Date(state.startedAt).toLocaleString()}, ${minutes(state.startedAt, ended)} minutes. Project: \`${config.project}\`.`);
    line();
    table(
      ["Agent", "Kind", "Model", "Prompts", "Turns", "Stopped", "Failed", "Waits", "Edits (tools)", "Edits (shell)"],
      config.agents.map((a) => {
        const id = state.panels[a.name]?.id ?? "";
        const n = (sql: string) => one<{ n: number }>(db, `SELECT count(*) AS n FROM session_events WHERE panel_id = ? AND ${sql}`, id)?.n ?? 0;
        return [
          a.name,
          a.kind,
          a.model ?? "default",
          n("json_extract(event, '$.kind') = 'prompt'"),
          n("json_extract(event, '$.kind') = 'turn_end'"),
          n("json_extract(event, '$.kind') = 'stopped'"),
          n("json_extract(event, '$.kind') = 'failed'"),
          n("json_extract(event, '$.kind') = 'waiting'"),
          n("json_extract(event, '$.kind') = 'tool' AND json_extract(event, '$.edit') = 1 AND json_extract(event, '$.tool') != 'shell'"),
          n("json_extract(event, '$.tool') = 'shell'"),
        ];
      }),
    );
    line("Counts come from the last 200 events Rails keeps per panel.");
    line();

    const usage = one<{ runs: number; tokens: number; cost: number }>(db, "SELECT count(*) AS runs, coalesce(sum(tokens), 0) AS tokens, coalesce(sum(cost), 0) AS cost FROM sprocket_usage WHERE sprocket_id = ?", sid);
    line(`## ${config.sprocket.name} (${config.sprocket.model ?? "default model"})`);
    line();
    line(`${usage?.runs ?? 0} runs, ${(usage?.tokens ?? 0).toLocaleString()} tokens${usage?.cost ? `, $${usage.cost.toFixed(4)}` : ""}. Rules: ${config.sprocket.rules?.length ?? 0}.`);
    line();
    const events = all<{ what: string; n: number; quiet: number; model: number; owned: number }>(
      db,
      `SELECT json_extract(event, '$.what') AS what, count(*) AS n, sum(coalesce(json_extract(event, '$.quiet'), 0)) AS quiet,
              sum(coalesce(json_extract(event, '$.byModel'), 0)) AS model, sum(instr(event, '"owns":true') > 0) AS owned
       FROM sprocket_messages WHERE sprocket_id = ? AND author = 'event' GROUP BY 1`,
      sid,
    );
    table(["Event", "Count", "Quiet (nothing needed)", "Woken by the decision model", "Owned files"], events.map((e) => [e.what, e.n, e.quiet, e.model, e.owned]));
    const talk = all<{ author: string; n: number }>(db, "SELECT author, count(*) AS n FROM sprocket_messages WHERE sprocket_id = ? GROUP BY 1", sid);
    line(`Chat: ${talk.map((t) => `${t.n} ${t.author}`).join(", ") || "nothing"}.`);
    line();

    const drafts = all<{ id: string; mode: string; status: string; rule: string | null; attachment: string | null }>(db, "SELECT id, mode, status, rule, attachment FROM suggestions WHERE sprocket_id = ?", sid);
    const sent = entries.filter((e) => e.type === "send") as { draft: string; edited: boolean }[];
    const edited = new Set(sent.filter((e) => e.edited).map((e) => e.draft));
    line("### Drafts");
    line();
    table(
      ["Kind", "Total", "Sent unedited", "Sent edited", "Dismissed", "Not sent (expired)", "Replaced", "Pending", "Followed a rule", "With the agent's words"],
      ["reply", "answer", "message"].map((mode) => {
        const d = drafts.filter((x) => x.mode === mode);
        const st = (s: string) => d.filter((x) => x.status === s).length;
        return [mode, d.length, d.filter((x) => x.status === "sent" && !edited.has(x.id)).length, d.filter((x) => x.status === "sent" && edited.has(x.id)).length, st("dismissed"), st("expired"), st("replaced"), st("pending"), d.filter((x) => x.rule).length, d.filter((x) => x.attachment).length];
      }),
    );
    const dismissed = entries.filter((e) => e.type === "dismiss") as { draft: string; why: string }[];
    if (dismissed.length) {
      line("Dismissed, and why:");
      for (const d of dismissed) line(`- ${d.draft.slice(0, 8)}: ${d.why}`);
      line();
    }

    const handoffs = all<{ status: string; n: number }>(db, "SELECT status, count(*) AS n FROM handoffs WHERE sprocket_id = ? GROUP BY 1", sid);
    line(`Handoffs: ${handoffs.map((h) => `${h.n} ${h.status}`).join(", ") || "none"}.`);
    const owners = all<{ panel_id: string; paths: string }>(db, "SELECT panel_id, group_concat(path, ', ') AS paths FROM owners WHERE project_id = ? GROUP BY panel_id", state.projectId ?? "");
    const nameOf = (id: string) => Object.entries(state.panels).find(([, p]) => p.id === id)?.[0] ?? id.slice(0, 8);
    line(`Owners: ${owners.map((o) => `${nameOf(o.panel_id)} (${o.paths})`).join("; ") || "none"}.`);
    line();

    const panelIds = Object.values(state.panels).map((p) => p.id);
    const marks = panelIds.map(() => "?").join(", ") || "''";
    const decisions = all<{ question: string; rails: string; label: string | null; n: number; acted: number; ms: number; errors: number }>(
      db,
      `SELECT question, rails, json_extract(answer, '$.label') AS label, count(*) AS n, sum(acted = 1) AS acted, round(avg(latency_ms)) AS ms, sum(error IS NOT NULL) AS errors
       FROM decisions WHERE panel_id IN (${marks}) GROUP BY 1, 2, 3`,
      ...panelIds,
    );
    line("## Decision model");
    line();
    if (decisions.length)
      table(
        ["Question", "Rails' rules", "Model said", "Count", "Woke the Coordinator", "Avg ms", "Errors"],
        decisions.map((d) => [d.question, d.rails, d.label ?? "(no answer)", d.n, d.acted, d.ms, d.errors]),
      );
    else line("No judgments (no decision model, or nothing to judge).\n");

    line("## What you did");
    line();
    const count = (t: string) => entries.filter((e) => e.type === t).length;
    line(`${count("prompt")} prompts typed, ${count("chat")} chat messages, ${sent.length} drafts sent (${edited.size} edited), ${dismissed.length} dismissed, ${count("commit")} commits.`);
    const notes = entries.filter((e) => e.type === "note") as { at: string; text: string }[];
    if (notes.length) {
      line();
      line("Notes:");
      for (const n of notes) line(`- ${new Date(n.at).toTimeString().slice(0, 5)} ${n.text}`);
    }
    line();

    line("## The project");
    line();
    if (existsSync(join(config.project, ".git"))) {
      const files = git(config.project, "ls-files").split("\n").filter(Boolean);
      const code = files.filter((f) => /\.(m?[jt]sx?|css|html)$/.test(f));
      const lines = code.reduce((n, f) => n + (existsSync(join(config.project, f)) ? readFileSync(join(config.project, f), "utf8").split("\n").length : 0), 0);
      line(`${git(config.project, "rev-list", "--count", "HEAD") || 0} commits, ${files.length} files, ${lines.toLocaleString()} lines of code in ${code.length} files.`);
    } else line("Not a git repository.");
  } finally {
    db.close();
  }
  const text = out.join("\n") + "\n";
  writeFileSync(join(runDir(config.name), "report.md"), text);
  return text;
}
