import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { WebSocketServer } from "ws";
import { serverInfo, onSignedOutEverywhere, signOutEverywhere } from "./account.ts";
import { accessToken, HOST, PORT } from "./config.ts";
import { watchCodex } from "./bridge/codex.ts";
import { loadAttention, receive, tokenOk as bridgeTokenOk } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";
import { gitDiff, gitStatus } from "./git.ts";
import type { OpenPanel, SprocketInput, SprocketSettings } from "@rails/shared";
import { closePanel, getWorkspace, openPanel, saveLayout } from "./panels.ts";
import { ServiceError } from "./errors.ts";
import { attachPickedFolder, attachProject, detachProject, getProject, listProjectSessions, recentFolders } from "./projects.ts";
import { providerInfo } from "./providers/index.ts";
import { getProfile, updateProfile } from "./profile.ts";
import { cancelSignIn, modelSettings, removeCredential, setApiKey, setDefaultModel, startSignIn, submitSignInCode } from "./models.ts";
import { createSprocket, deleteSprocket, listMessages, listSprockets, sendMessage, updateSettings, updateSprocket } from "./sprockets.ts";
import { TerminalHub } from "./terminals.ts";
import { startWatches } from "./watches.ts";
import { version as tmuxVersion } from "./tmux.ts";
import { sameSecret } from "./util.ts";

const COOKIE = "rails_token";
const hub = new TerminalHub();
const app = new Hono();

// After "sign out everywhere", close every connection; browsers with the new token reconnect. The delay
// lets the device that asked receive its new cookie before its own socket drops.
onSignedOutEverywhere(() => setTimeout(() => hub.disconnectAll(), 1000));

// Services throw ServiceError for expected failures; anything else is a 500 (Hono's default behavior).
app.onError((err, c) => {
  if (err instanceof ServiceError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.text("Internal Server Error", 500);
});

const setLoginCookie = (c: Context, token: string) =>
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 365 });

const tokenOk = (t: string | undefined) => sameSecret(t, accessToken());

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

// ---- bridge: agents in panels report what they do (ADR 0007). Loopback only, with the panel's own token
// (not the access token, which panels never get). Claude Code hooks read the empty JSON reply as "go on".
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// Claude Code's PostToolUse report holds the whole content of a file it wrote, so allow a few MB.
const BRIDGE_BODY_LIMIT = 4 * 1024 * 1024;
app.post("/bridge/:panelId/:source/:event", bodyLimit({ maxSize: BRIDGE_BODY_LIMIT, onError: (c) => c.json({}, 413) }), async (c) => {
  if (!LOOPBACK.has(getConnInfo(c).remote.address ?? "")) return c.json({ error: "Forbidden" }, 403);
  const panelId = c.req.param("panelId");
  if (!bridgeTokenOk(panelId, c.req.header("authorization")?.replace(/^Bearer\s+/i, ""))) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  receive(panelId, c.req.param("source"), c.req.param("event"), body, { inbox: c.req.query("inbox")?.slice(0, 300) || undefined });
  return c.json({});
});

// ---- auth ----
app.post("/api/auth/login", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  if (!tokenOk(token)) return c.json({ error: "Invalid token" }, 401);
  setLoginCookie(c, token!);
  return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  if (!tokenOk(getCookie(c, COOKIE))) return c.json({ error: "Unauthorized" }, 401);
  await next();
});

app.get("/api/auth/me", (c) => c.json({ ok: true }));

// ---- settings: this server and the account (one access token) ----
app.get("/api/server", async (c) => c.json(await serverInfo()));
app.post("/api/account/sign-out-everywhere", (c) => {
  const token = signOutEverywhere();
  setLoginCookie(c, token); // this device stays signed in
  return c.json({ token });
});

// ---- the profile: the name and avatar in the sidebar ----
app.get("/api/profile", (c) => c.json(getProfile()));
app.put("/api/profile", async (c) => c.json(updateProfile(await c.req.json<{ name?: unknown; avatar?: unknown }>())));

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

// ---- Models: what Sprockets run on (ADR 0006) ----
app.get("/api/models", async (c) => c.json(await modelSettings()));
app.put("/api/models/default", async (c) => {
  setDefaultModel((await c.req.json<{ model: unknown }>()).model);
  return c.json({ ok: true });
});
app.put("/api/models/providers/:id/key", async (c) => {
  await setApiKey(c.req.param("id"), (await c.req.json<{ key: unknown }>()).key);
  return c.json({ ok: true });
});
app.delete("/api/models/providers/:id", async (c) => {
  await removeCredential(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/models/providers/:id/sign-in", async (c) => {
  const body = await c.req.json<{ fresh?: unknown }>().catch(() => ({ fresh: false }));
  return c.json(await startSignIn(c.req.param("id"), body.fresh === true), 201);
});
app.post("/api/models/sign-ins/:id/code", async (c) => {
  await submitSignInCode(c.req.param("id"), (await c.req.json<{ code: unknown }>()).code);
  return c.json({ ok: true });
});
app.delete("/api/models/sign-ins/:id", async (c) => {
  await cancelSignIn(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- Sprockets (ADR 0005, 0006) ----
app.get("/api/sprockets", (c) => c.json(listSprockets()));

app.post("/api/sprockets", async (c) => c.json(createSprocket(await c.req.json<Partial<SprocketInput>>()), 201));

app.put("/api/sprockets/:id", async (c) => c.json(updateSprocket(c.req.param("id"), await c.req.json<Partial<SprocketInput>>())));

app.delete("/api/sprockets/:id", (c) => {
  deleteSprocket(c.req.param("id"));
  return c.json({ ok: true });
});

app.put("/api/sprockets/:id/settings", async (c) => c.json(updateSettings(c.req.param("id"), await c.req.json<SprocketSettings>())));

app.get("/api/sprockets/:id/messages", (c) => c.json(listMessages(c.req.param("id"))));

app.post("/api/sprockets/:id/messages", async (c) =>
  c.json(sendMessage(c.req.param("id"), (await c.req.json<{ text?: unknown }>()).text), 201),
);

// ---- static web build (production) ----
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: join(webDist, "index.html") }));
}

// ---- server + websocket ----
loadAttention(panels.all());
startWatches(); // Coordinators hear about sessions that wait for the user
watchCodex(panels.all()); // Codex panels that survived a restart

void tmuxVersion().then((v) => {
  if (!v) console.warn("warning: tmux isn't installed, so panels can't run. Run `make system-deps`.");
});

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`Rails server on ${url}`);
  console.log(`open: ${process.env.NODE_ENV === "production" ? url : "http://localhost:5173"}/?token=${accessToken()}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie ?? "")?.[1];
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
