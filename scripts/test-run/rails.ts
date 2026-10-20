// The run's own Rails: started from this checkout on its own home and ports, never the user's dev server.
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPO, type RunConfig } from "./run.ts";

/** The run's access token (a throwaway server, reachable on the LAN for watching in a browser). */
export const TOKEN = "t";
export const portOf = (config: RunConfig) => config.rails.port ?? 4319;

/** Start the server (and Vite when asked), detached, logging into the run's folder. Returns their process groups. */
export function startRails(config: RunConfig, dir: string, configDir: string): number[] {
  mkdirSync(config.rails.home, { recursive: true });
  const port = portOf(config);
  const out = openSync(join(dir, "server.log"), "a");
  const launcher = config.rails.launcher ? resolve(configDir, config.rails.launcher) : "src/index.ts";
  const env = { ...process.env, RAILS_HOME: config.rails.home, RAILS_PORT: String(port), RAILS_HOST: "0.0.0.0", RAILS_TOKEN: TOKEN };
  const server = spawn(join(REPO, "node_modules/.bin/tsx"), [launcher], { cwd: join(REPO, "packages/server"), env, detached: true, stdio: ["ignore", out, out] });
  server.unref();
  const pids = [server.pid!];
  if (config.rails.webPort) {
    const webOut = openSync(join(dir, "web.log"), "a");
    const web = spawn(join(REPO, "node_modules/.bin/vite"), ["--port", String(config.rails.webPort), "--strictPort", "--host", "0.0.0.0"], {
      cwd: join(REPO, "packages/web"),
      env: { ...process.env, RAILS_PORT: String(port) },
      detached: true,
      stdio: ["ignore", webOut, webOut],
    });
    web.unref();
    pids.push(web.pid!);
  }
  return pids;
}

/** Stop the run's processes (their whole groups: tsx and Vite start children). */
export function stopRails(pids: number[]): void {
  for (const pid of pids)
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // already gone
    }
}

/** Whether something already listens on a port (so the run doesn't take over someone else's server). */
export async function portTaken(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }).then(
    () => true,
    () => false,
  );
}

/** The run's server, logged in. */
export class Api {
  private cookie = "";
  constructor(private port: number) {}

  async waitUp(ms = 30_000): Promise<void> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await portTaken(this.port)) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Rails didn't start on :${this.port}. See server.log in the run's folder.`);
  }

  async login(): Promise<void> {
    const r = await fetch(`http://127.0.0.1:${this.port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) });
    if (!r.ok) throw new Error(`Can't log in to the run's Rails (${r.status}).`);
    this.cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.cookie) await this.login();
    const r = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: { cookie: this.cookie, origin: `http://127.0.0.1:${this.port}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path}: ${(data as any)?.error ?? r.status}`);
    return data as T;
  }
}
