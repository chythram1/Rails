import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { WebSocketServer } from "ws";
import type { ProviderId } from "@rails/shared";
import { HOST, PORT, TOKEN } from "./config.ts";
import { projects } from "./db.ts";
import { gitDiff, gitStatus } from "./git.ts";
import { LiveHub } from "./live/hub.ts";
import { attachProject, detachProject, getProject, listProjectSessions, ServiceError } from "./projects.ts";
import { discovery, findSession, providerInfo, suggestions } from "./providers/index.ts";

const COOKIE = "rails_token";
const hub = new LiveHub();
const app = new Hono();

// Services throw ServiceError for expected failures; anything else is a 500 (Hono's default behavior).
app.onError((err, c) => {
  if (err instanceof ServiceError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.text("Internal Server Error", 500);
});

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
  return c.json(attachProject(body.path, body.name), 201);
});

app.delete("/api/projects/:id", (c) => {
  detachProject(c.req.param("id"), (id) => hub.liveInfo().filter((l) => l.projectId === id).length);
  return c.json({ ok: true });
});

app.get("/api/project-suggestions", async (c) =>
  c.json(await suggestions(projects.list().map((p) => p.path))),
);

app.get("/api/projects/:id/sessions", async (c) =>
  c.json(await listProjectSessions(c.req.param("id"), (key) => hub.statusOf(key))),
);

app.get("/api/sessions/:provider/:id/messages", async (c) => {
  const provider = c.req.param("provider") as ProviderId;
  if (!discovery[provider]) return c.json({ error: "Unknown provider" }, 404);
  const s = await findSession(provider, c.req.param("id"));
  if (!s) return c.json([]); // brand-new live session whose transcript isn't on disk yet
  return c.json(await discovery[provider].readTranscript(s.file));
});

// ---- git (read-only) ----
app.get("/api/projects/:id/git", async (c) => c.json(await gitStatus(getProject(c.req.param("id")).path)));

app.get("/api/projects/:id/git/diff", async (c) =>
  c.text(await gitDiff(getProject(c.req.param("id")).path, c.req.query("path") ?? "")),
);

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
