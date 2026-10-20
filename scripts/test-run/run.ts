// A test run: its config (written by hand, see gearworks.example.json), its state (written by the harness in
// .test-runs/<name>/state.json) and its log of what the person running it did (log.jsonl), which the report reads.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Where runs keep their state, logs and reports (gitignored). */
export const RUNS = join(REPO, ".test-runs");

export type AgentKind = "claude" | "codex" | "pi";

export interface AgentConfig {
  /** What the run calls it ("engine"), for `prompt <name>`. */
  name: string;
  kind: AgentKind;
  /** The model's label in the agent's /model picker ("Sonnet 5.5", "gpt-6-luna"); its default when left out. */
  model?: string;
}

export interface RunConfig {
  name: string;
  /** A new or empty folder: the run's project. */
  project: string;
  /** The brief, relative to the config file: copied into the project as BRIEF.md and committed. */
  brief: string;
  rails: {
    /** RAILS_HOME. It needs the model providers the Sprocket uses (sign in once, or reuse a home). */
    home: string;
    /** Keep the home when cleaning up (it existed before the run, e.g. with your sign-ins). */
    reuseHome?: boolean;
    port?: number;
    /** Vite, for watching in a browser; none when left out. */
    webPort?: number;
    /** A script to start the server instead of packages/server/src/index.ts (e.g. one with a scripted model). */
    launcher?: string;
  };
  /** The fast decision model ("typesafe/jev-latest"), or null to turn it off; unchanged when left out. */
  decisionModel?: string | null;
  sprocket: { name: string; model?: string; description?: string; rules?: string[] };
  agents: AgentConfig[];
}

export interface RunState {
  config: RunConfig;
  configPath: string;
  startedAt: string;
  endedAt?: string;
  projectId?: string;
  sprocketId?: string;
  /** Panels by agent name. */
  panels: Record<string, { id: string; kind: AgentKind }>;
  /** The server's and Vite's process groups. */
  pids: number[];
  /** The newest Sprocket message `status` has shown. */
  seen: string;
  /** Whether Codex's config had a trust entry for the project before the run (cleanup removes one it added). */
  codexTrusted?: boolean;
  /** The sessions the run's agents used, by id: cleanup deletes their transcripts, and nothing else. */
  sessions?: Record<string, AgentKind>;
  /** Transcript folders for the project that didn't exist before the run (cleanup may remove them whole). */
  newDirs?: string[];
  /** The reused home's decision model before the run changed it (cleanup puts it back). */
  previousDecisionModel?: string | null;
}

export const runDir = (name: string) => join(RUNS, name);

export function loadConfig(path: string): RunConfig {
  const config = JSON.parse(readFileSync(path, "utf8")) as RunConfig;
  for (const key of ["name", "project", "brief", "rails", "sprocket", "agents"] as const)
    if (!config[key]) throw new Error(`${path}: "${key}" is missing.`);
  if (!/^[\w.-]+$/.test(config.name)) throw new Error(`${path}: the name may only use letters, digits, ".", "_" and "-".`);
  if (new Set(config.agents.map((a) => a.name)).size !== config.agents.length) throw new Error(`${path}: agent names must be different.`);
  return config;
}

/** A run's state: the named one, or the most recently started. */
export function loadState(name?: string): RunState {
  const pick =
    name ??
    (existsSync(RUNS)
      ? readdirSync(RUNS)
          .filter((n) => existsSync(join(RUNS, n, "state.json")))
          .sort((a, b) => statSync(join(RUNS, b, "state.json")).mtimeMs - statSync(join(RUNS, a, "state.json")).mtimeMs)[0]
      : undefined);
  if (!pick || !existsSync(join(RUNS, pick, "state.json"))) throw new Error(name ? `No run called "${name}".` : "No runs yet: start one with `setup <config.json>`.");
  return JSON.parse(readFileSync(join(RUNS, pick, "state.json"), "utf8")) as RunState;
}

export function saveState(state: RunState): void {
  mkdirSync(runDir(state.config.name), { recursive: true });
  writeFileSync(join(runDir(state.config.name), "state.json"), JSON.stringify(state, null, 2) + "\n");
}

export type LogEntry =
  | { type: "prompt"; agent: string; text: string }
  | { type: "chat"; text: string }
  | { type: "send"; draft: string; edited: boolean; why?: string }
  | { type: "dismiss"; draft: string; why: string }
  | { type: "note"; text: string }
  | { type: "commit"; message: string };

/** What the person running the test did, for the report. */
export function log(state: RunState, entry: LogEntry): void {
  appendFileSync(join(runDir(state.config.name), "log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

export function readLog(state: RunState): (LogEntry & { at: string })[] {
  const file = join(runDir(state.config.name), "log.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}
