#!/usr/bin/env node
// rails-agent: start an agent (or a shell) as a rails panel for the current folder, then attach this
// terminal to it. It's the same process the app shows, so typing in either place updates both.
// Talks to the local rails server over its REST API; needs no npm dependencies.
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

const KINDS = ["claude", "codex", "pi", "shell"];
const USAGE = `usage: rails-agent <claude|codex|pi|shell> [prompt...]

Starts the agent as a panel in the rails project that contains the current folder (adding the folder
as a project if none does) and attaches this terminal to it. The panel also shows in the app, live.
Detach with Ctrl-b d: the agent keeps running. Exiting the agent closes the panel.

Env: RAILS_HOME (default ~/.rails), RAILS_PORT (default 4317), RAILS_TOKEN (default from RAILS_HOME).`;

const fail = (msg) => {
  console.error(`rails-agent: ${msg}`);
  process.exit(1);
};

const [kind, ...words] = process.argv.slice(2);
if (kind === "-h" || kind === "--help") {
  console.log(USAGE);
  process.exit(0);
}
if (!KINDS.includes(kind)) {
  console.error(USAGE);
  process.exit(2);
}

const home = process.env.RAILS_HOME ?? join(homedir(), ".rails");
const base = `http://127.0.0.1:${process.env.RAILS_PORT ?? 4317}`;
const token = process.env.RAILS_TOKEN ?? readToken();

function readToken() {
  try {
    return JSON.parse(readFileSync(join(home, "config.json"), "utf8")).token;
  } catch {
    fail(`no access token in ${home}. Start the rails server once (make dev), or set RAILS_TOKEN.`);
  }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { cookie: `rails_token=${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
    });
  } catch {
    fail(`can't reach the rails server at ${base}. Is it running (make dev)?`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

// The innermost project containing this folder; otherwise attach the folder itself.
const cwd = realpathSync(process.cwd());
const inside = (dir) => cwd === dir || cwd.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const projects = await api("GET", "/api/projects");
let project = projects.filter((p) => inside(p.path)).sort((a, b) => b.path.length - a.path.length)[0];
if (!project) {
  project = await api("POST", "/api/projects", { path: cwd });
  console.error(`rails-agent: added ${cwd} as a project`);
}

const prompt = words.join(" ").trim() || undefined;
const panel = await api("POST", `/api/projects/${encodeURIComponent(project.id)}/panels`, { kind, prompt });
if (project.path !== cwd) console.error(`rails-agent: runs in the project folder ${project.path}`);

// Attach like the app does. Unset TMUX so this also works from inside another tmux.
const env = { ...process.env };
delete env.TMUX;
const { status, error } = spawnSync("tmux", ["-S", join(home, "tmux.sock"), "attach-session", "-t", `p-${panel.id}`], {
  stdio: "inherit",
  env,
});
if (error) fail(`couldn't run tmux: ${error.message}`);
process.exit(status ?? 0);
