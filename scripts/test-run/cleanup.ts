// Undo a run: close its panels and its Sprocket and project in Rails, stop its servers, delete the home it made, and
// the transcripts its agents left (Claude Code's and pi's folders for the project, Codex's threads through its daemon,
// as a client, never restarting it), and the trust entry Codex added to its config. The project folder (what the
// agents built) stays unless asked.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDb, sessionsOf } from "./db.ts";
import { Api, portOf, stopRails } from "./rails.ts";
import { REPO, saveState, type RunState } from "./run.ts";

/** Claude Code's and pi's transcript folders for a project path. */
export function transcriptDirs(project: string): string[] {
  return [join(homedir(), ".claude", "projects", project.replace(/[/.]/g, "-")), join(homedir(), ".pi", "agent", "sessions", `-${project.replace(/\//g, "-")}--`)];
}

/** Session ids come from agents' reports: only plain ones are used in paths. */
const safeId = (id: string) => /^[\w-]+$/.test(id);

/**
 * Delete the transcripts of the run's own sessions: Claude Code's `<id>.jsonl` (and its `<id>/` folder of subagent
 * transcripts) and pi's `*_<id>.jsonl`. Other sessions' transcripts in the same folders stay. A folder the run
 * created goes too, once no other session's transcript is in it.
 */
export function deleteTranscripts(project: string, sessions: Record<string, string>, newDirs: string[]): string[] {
  const [claudeDir, piDir] = transcriptDirs(project);
  const done: string[] = [];
  let files = 0;
  for (const [id, kind] of Object.entries(sessions)) {
    if (!safeId(id)) continue;
    const paths =
      kind === "claude"
        ? [join(claudeDir, `${id}.jsonl`), join(claudeDir, id)]
        : kind === "pi" && existsSync(piDir)
          ? readdirSync(piDir).filter((n) => n.endsWith(`_${id}.jsonl`)).map((n) => join(piDir, n))
          : [];
    for (const p of paths)
      if (existsSync(p)) {
        rmSync(p, { recursive: true, force: true });
        files++;
      }
  }
  if (files) done.push(`deleted ${files} transcript file${files > 1 ? "s" : ""} of the run's sessions`);
  for (const dir of newDirs)
    if (existsSync(dir) && !readdirSync(dir).some((n) => n.endsWith(".jsonl"))) {
      rmSync(dir, { recursive: true, force: true });
      done.push(`removed ${dir}, which the run created`);
    }
  return done;
}

/**
 * Codex threads started in the project during the run that the run didn't record (Codex can start a new one after
 * its trust prompt, which Rails may not map to the panel). Only listed, never deleted: one could be the user's.
 */
export function otherCodexThreads(project: string, since: string, known: Set<string>): string[] {
  const ids: string[] = [];
  const walk = (dir: string) => {
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.startsWith("rollout-") && statSync(path).mtime.toISOString() >= since) {
        try {
          const meta = JSON.parse(readFileSync(path, "utf8").split("\n", 1)[0]);
          const id = meta?.payload?.id;
          if (meta?.type === "session_meta" && meta.payload?.cwd === project && typeof id === "string" && !known.has(id)) ids.push(id);
        } catch {
          // not a rollout we understand
        }
      }
    }
  };
  walk(join(homedir(), ".codex", "sessions"));
  return ids;
}

/** Delete Codex threads through its daemon (thread/delete removes the rollout file too). */
async function deleteCodexThreads(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { default: WebSocket } = await import(join(REPO, "node_modules/ws/wrapper.mjs"));
  const ws = new WebSocket(`ws+unix://${join(homedir(), ".codex", "app-server-control", "app-server-control.sock")}:/`);
  let next = 0;
  const waiting = new Map<number, (m: any) => void>();
  const call = (method: string, params: object) =>
    new Promise<any>((done) => {
      const id = ++next;
      waiting.set(id, done);
      ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  ws.on("message", (d: Buffer) => {
    const m = JSON.parse(String(d));
    waiting.get(m.id)?.(m);
  });
  await new Promise((ok, fail) => {
    ws.on("open", ok);
    ws.on("error", fail);
  });
  await call("initialize", { clientInfo: { name: "rails-test-run", version: "0" }, capabilities: { experimentalApi: true } });
  ws.send(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
  const deleted: string[] = [];
  for (const id of ids) if (!(await call("thread/delete", { threadId: id })).error) deleted.push(id);
  ws.close();
  return deleted;
}

/** The trust entry Codex adds to its config for a folder (removed only if the run added it). */
export const codexTrustEntry = (project: string) => `\n[projects."${project}"]\ntrust_level = "trusted"\n`;
export const codexConfigPath = () => join(homedir(), ".codex", "config.toml");

export async function cleanup(state: RunState, { removeProject = false, keepTranscripts = false } = {}): Promise<string[]> {
  const done: string[] = [];
  const { config } = state;
  const project = existsSync(config.project) ? realpathSync(config.project) : config.project;

  // The run's sessions, while the database still knows them (with those `status` noted along the way).
  if (existsSync(join(config.rails.home, "rails.db"))) {
    const db = openDb(config.rails.home);
    try {
      state.sessions = { ...state.sessions, ...sessionsOf(db, Object.values(state.panels)) } as RunState["sessions"];
    } finally {
      db.close();
    }
    saveState(state);
  }

  // In Rails: panels (which stops their agents), the Sprocket, the project, and a reused home's decision model.
  const api = new Api(portOf(config));
  try {
    await api.login();
    if (state.previousDecisionModel !== undefined)
      await api.call("PUT", "/api/models/decisions", { model: state.previousDecisionModel }).then(
        () => {
          done.push("put the home's decision model back");
          delete state.previousDecisionModel;
        },
        () => done.push("couldn't put the home's decision model back: set it in Settings → Models"),
      );
    for (const [name, p] of Object.entries(state.panels)) await api.call("DELETE", `/api/panels/${p.id}`).then(() => done.push(`closed ${name}`), () => {});
    if (state.sprocketId) await api.call("DELETE", `/api/sprockets/${state.sprocketId}`).then(() => done.push("deleted the Sprocket"), () => {});
    if (state.projectId) await api.call("DELETE", `/api/projects/${state.projectId}`).then(() => done.push("detached the project"), () => {});
  } catch {
    done.push("Rails wasn't running: skipped closing panels");
  }
  stopRails(state.pids);
  done.push("stopped the run's servers");
  if (!config.rails.reuseHome) {
    try {
      execFileSync("tmux", ["-S", join(config.rails.home, "tmux.sock"), "kill-server"], { stdio: "ignore" });
    } catch {
      // no tmux server left
    }
    rmSync(config.rails.home, { recursive: true, force: true });
    done.push(`removed ${config.rails.home}`);
  }

  if (!keepTranscripts) {
    const sessions = state.sessions ?? {};
    done.push(...deleteTranscripts(project, sessions, state.newDirs ?? []));
    // Codex's threads by the ids its panels reported, never by folder: a session of the user's there stays.
    const threads = Object.entries(sessions).filter(([id, kind]) => kind === "codex" && safeId(id)).map(([id]) => id);
    const deleted = await deleteCodexThreads(threads).catch((e) => (done.push(`couldn't reach Codex's daemon: ${e.message}`), [] as string[]));
    if (deleted.length) done.push(`deleted ${deleted.length} Codex thread${deleted.length > 1 ? "s" : ""}`);
    if (config.agents.some((a) => a.kind === "codex")) {
      const others = otherCodexThreads(project, state.startedAt, new Set(threads));
      if (others.length)
        done.push(`left ${others.length} other Codex thread${others.length > 1 ? "s" : ""} started in the project during the run (check, then \`codex delete --force <id>\`): ${others.join(", ")}`);
    }
  }

  // Codex's trust entry, if the run added it.
  const toml = codexConfigPath();
  if (state.codexTrusted === false && existsSync(toml)) {
    const text = readFileSync(toml, "utf8");
    const entry = codexTrustEntry(project);
    if (text.includes(entry)) {
      writeFileSync(toml, text.replace(entry, ""));
      done.push("removed the project's trust entry from Codex's config");
    }
  }

  if (removeProject) {
    rmSync(config.project, { recursive: true, force: true });
    done.push(`removed ${config.project}`);
  }
  state.endedAt ??= new Date().toISOString();
  state.pids = [];
  saveState(state);
  return done;
}
