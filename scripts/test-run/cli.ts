// The test-run harness: run Rails with real coding agents on a brief, act as the user through the run, and report
// what happened. See README.md. Usage: npm run test-run -- <command> [args] [--run <name>]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cleanup, codexConfigPath, codexTrustEntry, transcriptDirs } from "./cleanup.ts";
import { Panes } from "./panes.ts";
import { Api, portOf, portTaken, startRails, TOKEN } from "./rails.ts";
import { report } from "./report.ts";
import { loadConfig, loadState, log, runDir, saveState, type RunState } from "./run.ts";
import { render, status, watch } from "./status.ts";

const USAGE = `Usage: npm run test-run -- <command> [args] [--run <name>]

  setup <config.json>          create the project from the brief, start Rails, the Sprocket and the agents
  status                       each agent, drafts waiting, what the Sprocket said, handoffs, owners
  watch [seconds]              repeat status until something needs you (default 600 s)
  prompt <agent> <text|@file>  type into an agent's panel, as the user
  chat <text>                  message the Sprocket
  send <draft> [--text <t>] [--why <w>]   send a draft (with --text: edited)
  dismiss <draft> --why <w>    dismiss a draft, saying why (the report lists it)
  note <text>                  write down something you noticed or did (the report lists it)
  commit <message>             commit the project as the test user
  report                       the run's numbers, also saved as .test-runs/<name>/report.md
  cleanup [--remove-project] [--keep-transcripts]   close everything the run started

Commands after setup act on the most recent run, or the one named with --run.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

const textArg = (raw: string) => (raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8").trim() : raw);
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=test-run@rails.local", "-c", "user.name=Rails test run", ...args], { cwd, stdio: "ignore" });

/**
 * With `nameSessions`, name each agent's session after the agent (ADR 0019) whenever its panel shows no name: once
 * Rails knows the session (Claude Code and pi from the start, Codex once it has a thread), and again if the panel
 * moves on to another session (Codex can start a thread it never uses).
 */
async function nameSessions(api: Api, state: RunState): Promise<string[]> {
  if (!state.config.nameSessions) return [];
  const { panels } = await api.call<{ panels: { id: string; kind: string; sessionId?: string; name?: string }[] }>("GET", `/api/projects/${state.projectId}/workspace`);
  const done: string[] = [];
  for (const agent of state.config.agents) {
    const panel = panels.find((p) => p.id === state.panels[agent.name]?.id);
    if (!panel?.sessionId || panel.name) continue;
    await api.call("PUT", `/api/projects/${state.projectId}/sessions/${encodeURIComponent(`${panel.kind}:${panel.sessionId}`)}/name`, { name: agent.name });
    done.push(agent.name);
  }
  return done;
}

/** The run's Sprocket's project chat (ADR 0021): where Rails' events, its drafts and the user's instructions go. */
async function projectChat(api: Api, state: RunState): Promise<string> {
  const list = await api.call<{ id: string; projectChat?: { id: string } }[]>("GET", "/api/sprockets");
  const chat = list.find((s) => s.id === state.sprocketId)?.projectChat?.id;
  if (!chat) throw new Error(`${state.config.sprocket.name} isn't attached to the run's project.`);
  return chat;
}

/** A draft by the start of its id, among the run's Sprocket's pending ones. */
async function findDraft(api: Api, state: RunState, prefix: string): Promise<{ id: string; text: string }> {
  const messages = await api.call<{ suggestions?: { id: string; text: string; status: string }[] }[]>("GET", `/api/chats/${await projectChat(api, state)}/messages`);
  const draft = messages.flatMap((m) => m.suggestions ?? []).find((s) => s.id.startsWith(prefix) && (s.status === "pending" || s.status === "failed"));
  if (!draft) throw new Error(`No pending draft starts with "${prefix}". See \`status\`.`);
  return draft;
}

async function setup(path: string): Promise<void> {
  const config = loadConfig(path);
  const configDir = dirname(resolve(path));
  const dir = runDir(config.name);
  if (existsSync(join(dir, "state.json")) && !loadState(config.name).endedAt) throw new Error(`Run "${config.name}" is still going: clean it up first, or pick another name.`);
  for (const port of [portOf(config), config.rails.webPort].filter(Boolean) as number[])
    if (await portTaken(port)) throw new Error(`Something already listens on :${port}. Pick other ports in the config.`);
  if (existsSync(config.project) && readdirSync(config.project).length) throw new Error(`${config.project} isn't empty: the run needs a new folder.`);
  if (existsSync(config.rails.home) && !config.rails.reuseHome) throw new Error(`${config.rails.home} exists: set "reuseHome": true to run on it (cleanup keeps it), or pick another.`);

  // The project: the brief, committed.
  mkdirSync(config.project, { recursive: true });
  copyFileSync(resolve(configDir, config.brief), join(config.project, "BRIEF.md"));
  git(config.project, "init", "-q");
  git(config.project, "add", "BRIEF.md");
  git(config.project, "commit", "-qm", "Add the brief");
  const project = realpathSync(config.project);

  mkdirSync(dir, { recursive: true });
  const state: RunState = { config, configPath: resolve(path), startedAt: new Date().toISOString(), panels: {}, pids: [], seen: "" };
  // Transcript folders that don't exist yet are the run's to remove; ones that do keep everything but its sessions.
  state.newDirs = transcriptDirs(project).filter((d) => !existsSync(d));
  const toml = codexConfigPath();
  if (config.agents.some((a) => a.kind === "codex")) state.codexTrusted = existsSync(toml) && readFileSync(toml, "utf8").includes(codexTrustEntry(project));
  state.pids = startRails(config, dir, configDir);
  saveState(state);
  const api = new Api(portOf(config));
  await api.waitUp();
  await api.login();
  console.log(`Rails is up on :${portOf(config)} (home ${config.rails.home}).`);

  // The models the Sprocket and the decision model need.
  const models = await api.call<{ models: { ref: string }[]; classifiers: { ref: string }[] }>("GET", "/api/models");
  if (config.sprocket.model && !models.models.some((m) => m.ref === config.sprocket.model))
    throw new Error(`The home has no model ${config.sprocket.model}: connect its provider in Settings → Providers (or reuse a home that has it), then clean up and set up again.`);
  const before = (models as { decisionModel?: string }).decisionModel ?? null;
  if (config.decisionModel !== undefined && config.decisionModel !== before) {
    if (config.decisionModel && !models.classifiers.some((c) => c.ref === config.decisionModel)) throw new Error(`The home has no decision model ${config.decisionModel}.`);
    if (config.rails.reuseHome) state.previousDecisionModel = before; // cleanup puts it back
    saveState(state);
    await api.call("PUT", "/api/models/decisions", { model: config.decisionModel });
  }

  // Each thing is saved as soon as it exists, so cleanup can undo a setup that stopped half way.
  const attached = await api.call<{ project?: { id: string }; id?: string }>("POST", "/api/projects", { path: project });
  state.projectId = attached.project?.id ?? attached.id;
  saveState(state);
  const looks = { character: "cog", color: "green", accessory: "none" };
  const sprocket = await api.call<{ id: string }>("POST", "/api/sprockets", { name: config.sprocket.name, look: looks });
  state.sprocketId = sprocket.id;
  saveState(state);
  await api.call("PUT", `/api/sprockets/${sprocket.id}/settings`, {
    projectId: state.projectId,
    ...(config.sprocket.model ? { model: config.sprocket.model } : {}),
    ...(config.sprocket.description ? { description: config.sprocket.description } : {}),
    ...(config.sprocket.rules ? { rules: config.sprocket.rules } : {}),
  });
  saveState(state);
  console.log(`${config.sprocket.name} looks after the project.`);

  const panes = new Panes(config.rails.home);
  for (const agent of config.agents) {
    const panel = await api.call<{ panel?: { id: string }; id?: string }>("POST", `/api/projects/${state.projectId}/panels`, { kind: agent.kind });
    const id = panel.panel?.id ?? panel.id!;
    state.panels[agent.name] = { id, kind: agent.kind };
    saveState(state);
    const done = await panes.prepare(id, agent);
    console.log(`${agent.name} (${agent.kind}): ${done.join(", ") || "ready"}.`);
  }
  state.seen = new Date().toISOString();
  saveState(state);
  const named = await nameSessions(api, state);
  if (named.length) console.log(`Named the sessions of ${named.join(", ")}${named.length < config.agents.length ? " (the others once Rails knows their session)" : ""}.`);
  const web = config.rails.webPort ? `http://<host>:${config.rails.webPort}/?token=${TOKEN}` : `no web UI (set rails.webPort)`;
  console.log(`\nReady. Watch it at ${web}. Next: \`prompt <agent> <text>\`, \`chat <text>\`, \`watch\`.`);
}

async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const runName = flag(args, "--run");
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help") return console.log(USAGE);
  if (command === "setup") {
    if (!rest[0]) throw new Error("setup needs a config file. See gearworks.example.json.");
    return setup(rest[0]).catch((e) => {
      throw new Error(`${e.message}\nSetup stopped. If it got as far as starting Rails, \`cleanup\` undoes what it started.`);
    });
  }

  const state = loadState(runName);
  const api = new Api(portOf(state.config));
  const name = () => nameSessions(api, state).then(() => {});
  switch (command) {
    case "status":
      await name().catch(() => {});
      return console.log(render(status(state), undefined, state.config.sprocket.name));
    case "watch":
      return console.log(await watch(state, Number(rest[0] ?? 600), name));
    case "prompt": {
      const [agent, ...words] = rest;
      const panel = state.panels[agent];
      if (!panel) throw new Error(`No agent "${agent}". The run's agents: ${Object.keys(state.panels).join(", ")}.`);
      const text = textArg(words.join(" "));
      await new Panes(state.config.rails.home).type(panel.id, text);
      log(state, { type: "prompt", agent, text });
      return console.log(`Typed into ${agent}.`);
    }
    case "chat": {
      const text = textArg(rest.join(" "));
      await api.call("POST", `/api/chats/${await projectChat(api, state)}/messages`, { text });
      log(state, { type: "chat", text });
      return console.log(`Sent to ${state.config.sprocket.name}.`);
    }
    case "send": {
      const edit = flag(rest, "--text");
      const why = flag(rest, "--why");
      const draft = await findDraft(api, state, rest[0] ?? "");
      const text = edit === undefined ? undefined : textArg(edit);
      const r = await api.call<{ status: string; queued?: boolean; error?: string }>("POST", `/api/suggestions/${draft.id}/send`, text === undefined ? {} : { text });
      log(state, { type: "send", draft: draft.id, edited: text !== undefined && text.trim() !== draft.text.trim(), ...(why ? { why } : {}) });
      return console.log(`${r.status}${r.queued ? " (queued: the session is busy)" : ""}${r.error ? `: ${r.error}` : ""}`);
    }
    case "dismiss": {
      const why = flag(rest, "--why");
      if (!why) throw new Error("Say why with --why: the report lists it.");
      const draft = await findDraft(api, state, rest[0] ?? "");
      await api.call("POST", `/api/suggestions/${draft.id}/dismiss`);
      log(state, { type: "dismiss", draft: draft.id, why });
      return console.log("Dismissed.");
    }
    case "note":
      log(state, { type: "note", text: rest.join(" ") });
      return console.log("Noted.");
    case "commit": {
      const message = rest.join(" ") || "Checkpoint";
      git(state.config.project, "add", "-A");
      git(state.config.project, "commit", "-qm", message);
      log(state, { type: "commit", message });
      return console.log(`Committed: ${message}`);
    }
    case "report":
      return console.log(report(state));
    case "cleanup": {
      const removeProject = rest.includes("--remove-project");
      const keepTranscripts = rest.includes("--keep-transcripts");
      try {
        report(state); // keep the numbers before the home goes
      } catch {
        // cleaned up before: the home (and its database) is gone, the earlier report stays
      }
      for (const line of await cleanup(state, { removeProject, keepTranscripts })) console.log(`- ${line}`);
      return console.log(`The report is in ${join(runDir(state.config.name), "report.md")}.`);
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
