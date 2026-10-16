import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { WebSocketServer } from "ws";
import { HOST, PORT, TOKEN } from "./config.ts";
import { projects } from "./db.ts";
import { gitDiff, gitStatus } from "./git.ts";
import { closePanel, getWorkspace, openPanel, saveLayout, type OpenPanel } from "./panels.ts";
import { ServiceError } from "./errors.ts";
import { attachPickedFolder, attachProject, detachProject, getProject, listProjectSessions, recentFolders } from "./projects.ts";
import { providerInfo } from "./providers/index.ts";
import { TerminalHub } from "./terminals.ts";
import { version as tmuxVersion } from "./tmux.ts";

const COOKIE = "rails_token";
const hub = new TerminalHub();
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

/**
 * Whether a browser request comes from the rails page itself. Cookies are shared by every port of a
 * host (SameSite ignores ports), so without this a page served from any other port, such as another dev
 * server, could use the login cookie to drive panels. Requests without an Origin (curl) aren't
 * cross-site browser requests and still need the token.
 */
const sameOrigin = (origin: string | undefined, host: string | undefined) => {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && !sameOrigin(c.req.header("origin"), c.req.header("host"))) {
    return c.json({ error: "Cross-origin request refused" }, 403);
  }
  await next();
});

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
  detachProject(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/recent-folders", async (c) => c.json(await recentFolders()));

// Opens the native folder picker on the server's screen and waits for the user's choice.
app.post("/api/projects/pick", async (c) => c.json({ project: await attachPickedFolder() }));

app.get("/api/projects/:id/sessions", async (c) =>
  c.json(await listProjectSessions(c.req.param("id"))),
);

// ---- workspace: terminal panels (ADR 0003) ----
app.get("/api/projects/:id/workspace", async (c) => c.json(await getWorkspace(c.req.param("id"))));

app.post("/api/projects/:id/panels", async (c) => c.json(await openPanel(c.req.param("id"), await c.req.json<OpenPanel>()), 201));

app.delete("/api/panels/:id", async (c) => {
  await closePanel(c.req.param("id"));
  return c.json({ ok: true });
});

app.put("/api/projects/:id/layout", async (c) => {
  saveLayout(c.req.param("id"), (await c.req.json<{ layout: unknown }>()).layout);
  return c.json({ ok: true });
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
void tmuxVersion().then((v) => {
  if (!v) console.warn("warning: tmux isn't installed, so panels can't run. Run `make system-deps`.");
});

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`rails server on ${url}`);
  console.log(`open: ${process.env.NODE_ENV === "production" ? url : "http://localhost:5173"}/?token=${TOKEN}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const cookie = /(?:^|;\s*)rails_token=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const authorized = tokenOk(cookie && decodeURIComponent(cookie)) && sameOrigin(req.headers.origin, req.headers.host);
  if (url.pathname !== "/ws" || !authorized) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => hub.connect(ws));
});

const shutdown = () => {
  hub.detachAll(); // panel processes keep running in tmux
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
