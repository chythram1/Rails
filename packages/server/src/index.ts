import { timingSafeEqual } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { WebSocketServer } from "ws";
import { sessionKey, type ProviderId, type SessionSummary } from "@rails/shared";
import { HOST, PORT, TOKEN } from "./config.ts";
import { projects } from "./db.ts";
import { gitDiff, gitStatus } from "./git.ts";
import { LiveHub } from "./live/hub.ts";
import { discovery, findSession, providerInfo, sessionsFor, suggestions } from "./providers/index.ts";

const COOKIE = "rails_token";
const hub = new LiveHub();
const app = new Hono();

const tokenOk = (t: string | undefined) => {
  if (!t) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
};

// ---- auth ----
app.post("/api/auth/login", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  if (!tokenOk(token)) return c.json({ error: "Invalid token" }, 401);
  setCookie(c, COOKIE, token!, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  if (!tokenOk(getCookie(c, COOKIE))) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

app.get("/api/auth/me", (c) => c.json({ ok: true }));

// ---- providers / projects ----
app.get("/api/providers", (c) => c.json(providerInfo()));

app.get("/api/projects", (c) => c.json(projects.list()));

app.post("/api/projects", async (c) => {
  const body = await c.req.json<{ path?: string; name?: string }>();
  if (!body.path) return c.json({ error: "path is required" }, 400);
  let path = resolve(body.path.replace(/^~(?=\/|$)/, process.env.HOME ?? "~")).replace(/\/+$/, "") || "/";
  if (!existsSync(path) || !statSync(path).isDirectory()) return c.json({ error: "Not a directory" }, 400);
  path = realpathSync(path); // agents record the real cwd (e.g. /tmp -> /private/tmp)
  if (projects.list().some((p) => p.path === path)) return c.json({ error: "Project already attached" }, 409);
  return c.json(projects.create(body.name?.trim() || basename(path), path), 201);
});

app.delete("/api/projects/:id", (c) => {
  projects.remove(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/project-suggestions", async (c) =>
  c.json(await suggestions(projects.list().map((p) => p.path))),
);

app.get("/api/projects/:id/sessions", async (c) => {
  const project = projects.get(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const found = await sessionsFor(project.path);
  const out: SessionSummary[] = found.map((s) => {
    const key = sessionKey(s.provider, s.id);
    return { key, provider: s.provider, id: s.id, cwd: s.cwd, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, liveStatus: hub.statusOf(key) };
  });
  return c.json(out);
});

app.get("/api/sessions/:provider/:id/messages", async (c) => {
  const provider = c.req.param("provider") as ProviderId;
  if (!discovery[provider]) return c.json({ error: "Unknown provider" }, 404);
  const s = await findSession(provider, c.req.param("id"));
  if (!s) return c.json([]); // brand-new live session whose transcript isn't on disk yet
  return c.json(await discovery[provider].readTranscript(s.file));
});

// ---- git (read-only) ----
app.get("/api/projects/:id/git", async (c) => {
  const project = projects.get(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.json(await gitStatus(project.path));
});

app.get("/api/projects/:id/git/diff", async (c) => {
  const project = projects.get(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.text(await gitDiff(project.path, c.req.query("path") ?? ""));
});

// ---- static web build (production) ----
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: join(webDist, "index.html") }));
}

// ---- server + websocket ----
const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`rails server on ${url}`);
  console.log(`open: ${process.env.NODE_ENV === "production" ? url : "http://localhost:5173"}/?token=${TOKEN}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const cookie = /(?:^|;\s*)rails_token=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  if (url.pathname !== "/ws" || !tokenOk(cookie && decodeURIComponent(cookie))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => hub.connect(ws));
});

const shutdown = () => {
  hub.stopAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
