// The Coordinator check: replays situations from test run 2 against the real Coordinator on a real model, a few
// times each, and checks what it drafted. No agents, panels or servers: sessions are transcripts and bridge
// events in throwaway folders. See README.md.
//
//   npm run coordinator-check -- [--model openai/gpt-6-luna] [--repeat 3] [--only a,b] [--label before]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    model: { type: "string", default: "openai/gpt-6-luna" },
    repeat: { type: "string", default: "3" },
    only: { type: "string" },
    label: { type: "string", default: "check" },
    home: { type: "string", default: "/tmp/rails-check" },
  },
});

// A home that holds only the model sign-in (credentials.json); everything else starts fresh each time, so the
// check deletes its database. Make sure it's a check home first, never someone's Rails home.
const home = opts.home;
const refuse = (why: string) => {
  console.error(`Not using ${home}: ${why}`);
  process.exit(1);
};
if (!existsSync(join(home, "credentials.json")))
  refuse(`no sign-in there. Start a server with RAILS_HOME=${home} once, connect a provider in Settings → Providers, and stop it.`);
const MARKER = ".coordinator-check";
// What a sign-in server and the check leave there. A home that has had panels has more (tmux.sock, for one).
const KNOWN = new Set(["credentials.json", "config.json", "tmux.conf", "rails.db", "rails.db-wal", "rails.db-shm", "providers", "projects", MARKER]);
const other = readdirSync(home).filter((f) => !KNOWN.has(f));
if (other.length) refuse(`it holds ${other.join(", ")}, so it looks like a Rails home in use. Use a home of its own (--home).`);
try {
  if (execFileSync("lsof", ["-t", join(home, "rails.db")], { encoding: "utf8" }).trim()) refuse("a Rails server is using it. Stop it first.");
} catch {
  // lsof exits 1 when nothing has the file open (or there's no lsof, or no database yet)
}
if (!existsSync(join(home, MARKER))) {
  // First use: only a home without projects, i.e. one that was only signed in.
  const db = existsSync(join(home, "rails.db")) ? new DatabaseSync(join(home, "rails.db"), { readOnly: true }) : undefined;
  const projects = db ? Number((db.prepare("SELECT count(*) AS n FROM projects").get() as { n: number }).n) : 0;
  db?.close();
  if (projects) refuse(`it has ${projects} project${projects === 1 ? "" : "s"}, so it looks like a Rails home in use. Use a home of its own (--home).`);
  writeFileSync(join(home, MARKER), "This is a home for npm run coordinator-check, which deletes its database on each run.\n");
}
for (const f of ["rails.db", "rails.db-wal", "rails.db-shm", "providers", "projects"]) rmSync(join(home, f), { recursive: true, force: true });
Object.assign(process.env, {
  RAILS_HOME: home,
  CLAUDE_HOME: join(home, "providers", "claude"),
  PI_HOME: join(home, "providers", "pi"),
  CODEX_HOME: join(home, "providers", "codex"),
  CHECK_PROJECTS: join(home, "projects"),
});
for (const d of ["CLAUDE_HOME", "PI_HOME", "CODEX_HOME", "CHECK_PROJECTS"]) mkdirSync(process.env[d]!, { recursive: true });

// The server reads its paths when it's imported, so only now.
const { FILES, SCENARIOS } = await import("./scenarios.ts");
const { World } = await import("./world.ts");
const { idle } = await import("../../packages/server/src/runs.ts");
const { findModel } = await import("../../packages/server/src/models.ts");

if (!findModel(opts.model)) {
  console.error(`The model ${opts.model} isn't available in ${home}.`);
  process.exit(1);
}
const only = opts.only?.split(",");
const scenarios = SCENARIOS.filter((s) => !only || only.includes(s.name));
const repeat = Number(opts.repeat);

console.log(`${scenarios.length} situations × ${repeat} on ${opts.model}…`);
const started = Date.now();
type Scenario = (typeof SCENARIOS)[number];
type Play = { s: Scenario; r: number; w: InstanceType<typeof World>; check: Awaited<ReturnType<Scenario["play"]>> };
const plays: Play[] = [];
for (let r = 1; r <= repeat; r++)
  for (const s of scenarios) {
    const w = new World(`${s.name}-${r}`, FILES, opts.model);
    plays.push({ s, r, w, check: await s.play(w) });
  }
const TIMEOUT_MS = 30 * 60_000;
const settle = async () => {
  const finished = await Promise.race([idle().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), TIMEOUT_MS))]);
  if (!finished) console.log(`Some runs were still going after ${TIMEOUT_MS / 60_000} minutes; they count as they are.`);
};
await settle();
// A run the provider failed (a dropped connection, a timeout) says nothing about the Coordinator: play it again.
const failed = (p: Play) => p.w.outcome().notices.some((n) => n.startsWith("The model returned an error"));
let retried = 0;
for (let round = 1; round <= 2 && plays.some(failed); round++) {
  for (const [i, p] of plays.entries()) {
    if (!failed(p)) continue;
    retried++;
    const w = new World(`${p.s.name}-${p.r}-again${round}`, FILES, opts.model);
    plays[i] = { ...p, w, check: await p.s.play(w) };
  }
  await settle();
}

// ---- results ----

const results = plays.map((p) => {
  const o = p.w.outcome();
  return { ...p, o, checks: p.check(o) };
});
const lines = [
  `# Coordinator check: ${opts.label}`,
  "",
  `${new Date().toISOString()}, ${opts.model}, ${repeat} each, ${Math.round((Date.now() - started) / 1000)} s. Played again after a provider error: ${retried}.`,
  "",
];
let passed = 0;
let total = 0;
let cost = 0;
for (const s of scenarios) {
  const mine = results.filter((x) => x.s === s);
  lines.push(`## ${s.name}`, "", `Run 2: ${s.run2}`, "", "| Check | Passed |", "| --- | --- |");
  for (const [i, c] of mine[0].checks.entries()) {
    const n = mine.filter((x) => x.checks[i].ok).length;
    passed += n;
    total += mine.length;
    lines.push(`| ${c.what} | ${n}/${mine.length} |`);
  }
  for (const x of mine) {
    cost += x.o.usage.cost;
    lines.push("", `### ${s.name} #${x.r}${x.o.quiet ? " (quiet)" : ""}: ${x.checks.filter((c) => c.ok).length}/${x.checks.length}`, "");
    for (const c of x.checks.filter((c) => !c.ok)) lines.push(`- ✗ ${c.what}`);
    if (x.o.reply) lines.push("", "Reply:", "", ...x.o.reply.split("\n").map((l) => `> ${l}`));
    if (x.o.activity) lines.push("", `Tools: ${x.o.activity}`);
    for (const d of x.o.drafts) lines.push("", `Draft (${d.mode}${d.rule ? `, rule ${d.rule}` : ""}${d.attachment ? ", with the agent's words" : ""}) for "${d.title}":`, "", ...d.text.split("\n").map((l) => `> ${l}`));
    for (const n of x.o.notices) lines.push("", `Notice: ${n}`);
    if (x.o.steps.length) lines.push("", "<details><summary>Tool calls</summary>", "", "```json", JSON.stringify(x.o.steps, null, 1).slice(0, 20000), "```", "</details>");
  }
  lines.push("");
}
lines.splice(3, 0, `**${passed}/${total} checks passed.** Model cost: $${cost.toFixed(4)}.`, "");

const dir = join(import.meta.dirname, "..", "..", ".test-runs", "coordinator-check");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${opts.label}-${opts.model.replace(/\//g, "_")}-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.md`);
writeFileSync(file, lines.join("\n"));

for (const s of scenarios) {
  const mine = results.filter((x) => x.s === s);
  console.log(`${s.name}: ${mine[0].checks.map((c, i) => `${c.what} ${mine.filter((x) => x.checks[i].ok).length}/${mine.length}`).join(", ")}`);
}
console.log(`\n${passed}/${total} checks passed, $${cost.toFixed(4)}. Report: ${file}`);
process.exit(0);
