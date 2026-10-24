// The HTTP app: auth, the bridge and every route. index.ts starts it; tests call it with `app.request()`.
import { existsSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serverInfo, signOutEverywhere } from "./account.ts";
import { mcpRequest } from "./agentTools.ts";
import { accessToken } from "./config.ts";
import { claudeInbox, piInbox } from "./bridge/deliver.ts";
import { receive, tokenOk as bridgeTokenOk } from "./bridge/index.ts";
import { projects } from "./db.ts";
import { gitDiff, gitStatus } from "./workspace/git.ts";
import { listFolder, previewFile } from "./workspace/tree.ts";
import { nameSession } from "./workspace/names.ts";
import type { AutomationInput, ConnectorInput, McpAppInput, McpServerInput, OpenPanel, SavedPromptInput, SkillInput, SprocketTeamInput, SprocketInput, SprocketSettings } from "@rails/shared";
import { createPrompt, deletePrompt, listPrompts, updatePrompt } from "./customize.ts";
import { createAutomation, deleteAutomation, getAutomation, listAutomations, runAutomation, updateAutomation } from "./automations.ts";
import { addConnector, cancelSignIn as cancelMcpSignIn, createServer, deleteServer, listApps, listServers, pasteSignIn, setApp, signOut, startSignIn as startMcpSignIn, testServer, updateServer } from "./mcp.ts";
import { createSkill, deleteSkill, importSkill, listSkills, skillSources, updateSkill } from "./skills.ts";
import { decideApproval } from "./approvals.ts";
import { actOnCard } from "./cardActions.ts";
import { closePanel, getWorkspace, openPanel, saveLayout } from "./workspace/panels.ts";
import { ServiceError } from "./errors.ts";
import { attachPickedFolder, attachProject, detachProject, getProject, listProjectSessions, recentFolders } from "./workspace/projects.ts";
import { providerInfo } from "./providers/index.ts";
import { getProfile, updateProfile } from "./profile.ts";
import { cancelSignIn, modelSettings, removeCredential, setApiKey, setDefaultModel, startSignIn, submitSignInCode } from "./models.ts";
import { createTeam, deleteTeam, listTeams, updateTeam } from "./teams.ts";
import { clearChat, createSprocket, deleteSprocket, listMessages, listSprockets, sendMessage, updateSettings, updateSprocket } from "./sprockets.ts";
import { cancelHandoff } from "./handoffs.ts";
import { clearOwner } from "./owners.ts";
import { dismissSuggestion, sendSuggestion } from "./suggestions.ts";
import { decisionLog, setDecisionModel, setDecisionThreshold } from "./decisions.ts";
import { sameSecret } from "./util.ts";

const COOKIE = "rails_token";
export const app = new Hono();

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

/** Whether a WebSocket upgrade may connect: the login cookie, from the rails page itself. */
export function upgradeAuthorized(headers: IncomingHttpHeaders): boolean {
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(headers.cookie ?? "")?.[1];
  return tokenOk(cookie && decodeURIComponent(cookie)) && sameOrigin(headers.origin, headers.host);
}

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
/** Whether a bridge request comes from the panel itself: over loopback, with its token. */
const fromPanel = (c: Context, panelId: string) =>
  LOOPBACK.has(getConnInfo(c).remote.address ?? "") && bridgeTokenOk(panelId, c.req.header("authorization")?.replace(/^Bearer\s+/i, ""));
// Everything under a panel's bridge path is for that panel alone.
app.use("/bridge/:panelId/*", async (c, next) => {
  if (!fromPanel(c, c.req.param("panelId"))) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
// Agent tools (ADR 0018): an MCP server for the agent in the panel (Streamable HTTP with plain JSON replies; no
// event stream, so GET is refused, as the transport allows).
app.post("/bridge/:panelId/mcp", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({}, 413) }), async (c) => {
  const panelId = c.req.param("panelId");
  // The request's signal ends a wait_for when the agent gives up on the call (interrupted, or its time ran out).
  const reply = await mcpRequest(panelId, await c.req.json().catch(() => null), c.req.raw.signal);
  return reply ? c.json(reply) : c.body(null, 202);
});
app.get("/bridge/:panelId/mcp", (c) => c.body(null, 405));
// The pi extension's long poll for replies the user sends (ADR 0010).
app.get("/bridge/:panelId/pi/inbox", async (c) => {
  const panelId = c.req.param("panelId");
  return c.json({ messages: await piInbox.poll(panelId, c.req.raw.signal) });
});
app.post("/bridge/:panelId/pi/delivered", async (c) => {
  const panelId = c.req.param("panelId");
  type Delivered = { id?: unknown; ok?: unknown; queued?: unknown; error?: unknown };
  const body = await c.req.json<Delivered>().catch(() => ({}) as Delivered);
  piInbox.ack(panelId, body.id, body.ok, body.queued, body.error);
  return c.json({});
});
// Rails' Claude Code mod: its poll for answers to an open question dialog, and whether it took one (ADR 0028).
app.get("/bridge/:panelId/claude/inbox", async (c) => {
  const panelId = c.req.param("panelId");
  return c.json({ messages: await claudeInbox.poll(panelId, c.req.raw.signal) });
});
app.post("/bridge/:panelId/claude/delivered", async (c) => {
  const panelId = c.req.param("panelId");
  type Delivered = { id?: unknown; ok?: unknown; error?: unknown };
  const body = await c.req.json<Delivered>().catch(() => ({}) as Delivered);
  claudeInbox.ack(panelId, body.id, body.ok, false, body.error);
  return c.json({});
});
app.post("/bridge/:panelId/:source/:event", bodyLimit({ maxSize: BRIDGE_BODY_LIMIT, onError: (c) => c.json({}, 413) }), async (c) => {
  const panelId = c.req.param("panelId");
  const body = await c.req.json().catch(() => ({}));
  receive(panelId, c.req.param("source"), c.req.param("event"), body, { inbox: c.req.query("inbox")?.slice(0, 300) || undefined });
  return c.json({});
});

// ---- auth ----
app.post("/api/auth/login", async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
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

app.put("/api/projects/:id/sessions/:key/name", async (c) =>
  c.json(await nameSession(c.req.param("id"), c.req.param("key"), (await c.req.json<{ name?: unknown }>()).name)),
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

// ---- the file tree (read-only) ----
app.get("/api/projects/:id/files", async (c) => c.json(await listFolder(getProject(c.req.param("id")).path, c.req.query("dir") ?? "")));
app.get("/api/projects/:id/files/content", async (c) => c.json(await previewFile(getProject(c.req.param("id")).path, c.req.query("path") ?? "")));
// ---- Customize (ADR 0025): saved prompts, MCP servers, skills ----
app.get("/api/mcp", (c) => c.json(listServers()));
app.get("/api/mcp/apps", (c) => c.json(listApps()));
app.put("/api/mcp/apps/:id", async (c) => c.json(await setApp(c.req.param("id"), await c.req.json<McpAppInput>())));
app.post("/api/mcp", async (c) => c.json(createServer(await c.req.json<McpServerInput>()), 201));
app.put("/api/mcp/:id", async (c) => c.json(updateServer(c.req.param("id"), await c.req.json<McpServerInput>())));
app.delete("/api/mcp/:id", (c) => {
  deleteServer(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/mcp/:id/test", async (c) => c.json(await testServer(c.req.param("id"))));
// Add a connector (a server Rails knows, shared CONNECTORS).
app.post("/api/connectors/:id", async (c) => c.json(await addConnector(c.req.param("id"), await c.req.json<ConnectorInput>().catch(() => ({}))), 201));
// Signing in to a remote server (OAuth): start, the address pasted from another device, cancel, sign out.
app.post("/api/mcp/:id/sign-in", async (c) => c.json(await startMcpSignIn(c.req.param("id"))));
app.post("/api/mcp/:id/sign-in/address", async (c) => c.json(await pasteSignIn(c.req.param("id"), (await c.req.json<{ address: unknown }>()).address)));
app.delete("/api/mcp/:id/sign-in", async (c) => {
  await cancelMcpSignIn(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/mcp/:id/sign-out", async (c) => c.json(await signOut(c.req.param("id"))));
app.get("/api/skills", (c) => c.json(listSkills()));
app.get("/api/skills/sources", (c) => c.json(skillSources()));
app.post("/api/skills/import", async (c) => c.json(await importSkill((await c.req.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown })).path)));
app.post("/api/skills", async (c) => c.json(createSkill(await c.req.json<SkillInput>()), 201));
app.put("/api/skills/:id", async (c) => c.json(updateSkill(c.req.param("id"), await c.req.json<SkillInput>())));
app.delete("/api/skills/:id", (c) => {
  deleteSkill(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/cards/:id/actions", async (c) => {
  await actOnCard(c.req.param("id"), await c.req.json<{ index?: unknown; run?: unknown }>());
  return c.json({ ok: true });
});
app.post("/api/approvals/:id", async (c) => {
  await decideApproval(c.req.param("id"), (await c.req.json<{ allow?: unknown }>()).allow);
  return c.json({ ok: true });
});
app.get("/api/prompts", (c) => c.json(listPrompts()));
app.post("/api/prompts", async (c) => c.json(createPrompt(await c.req.json<SavedPromptInput>()), 201));
app.put("/api/prompts/:id", async (c) => c.json(updatePrompt(c.req.param("id"), await c.req.json<SavedPromptInput>())));
app.delete("/api/prompts/:id", (c) => {
  deletePrompt(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- automations (ADR 0032) ----
app.get("/api/automations", (c) => c.json(listAutomations()));
app.post("/api/automations", async (c) => c.json(createAutomation(await c.req.json<AutomationInput>()), 201));
app.get("/api/automations/:id", (c) => c.json(getAutomation(c.req.param("id"))));
app.patch("/api/automations/:id", async (c) => c.json(updateAutomation(c.req.param("id"), await c.req.json<AutomationInput>())));
app.delete("/api/automations/:id", (c) => {
  deleteAutomation(c.req.param("id"));
  return c.json({ ok: true });
});
app.post("/api/automations/:id/run", (c) => c.json(runAutomation(c.req.param("id")), 201));

// ---- git (read-only) ----
app.get("/api/projects/:id/git", async (c) => c.json(await gitStatus(getProject(c.req.param("id")).path)));

app.get("/api/projects/:id/git/diff", async (c) =>
  c.text(await gitDiff(getProject(c.req.param("id")).path, c.req.query("path") ?? "")),
);

// ---- Models: what Sprockets run on (ADR 0006) ----
app.get("/api/models", async (c) => c.json(await modelSettings()));
app.put("/api/models/decisions", async (c) => {
  await setDecisionModel((await c.req.json<{ model?: unknown }>()).model ?? null);
  return c.json({ ok: true });
});
app.put("/api/models/decisions/threshold", async (c) => {
  setDecisionThreshold((await c.req.json<{ threshold?: unknown }>()).threshold);
  return c.json({ ok: true });
});
app.get("/api/decisions", (c) => c.json(decisionLog()));
app.put("/api/models/default", async (c) => {
  setDefaultModel((await c.req.json<{ model: unknown }>()).model);
  return c.json({ ok: true });
});
app.put("/api/models/providers/:id/key", async (c) => {
  return c.json(await setApiKey(c.req.param("id"), (await c.req.json<{ key: unknown }>()).key));
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

// Team chats (ADR 0022): the user and two to four Sprockets. Their messages are a chat's, below.
app.get("/api/teams", (c) => c.json(listTeams()));

app.post("/api/teams", async (c) => c.json(createTeam(await c.req.json<Partial<SprocketTeamInput>>()), 201));

app.put("/api/teams/:id", async (c) => c.json(updateTeam(c.req.param("id"), await c.req.json<Partial<SprocketTeamInput>>())));

app.delete("/api/teams/:id", (c) => {
  deleteTeam(c.req.param("id"));
  return c.json({ ok: true });
});

// Chats (ADR 0021, 0022): a Sprocket's direct chat, its project's chat and teams, by chat id. DELETE clears one.
app.get("/api/chats/:id/messages", (c) => c.json(listMessages(c.req.param("id"))));

app.post("/api/chats/:id/messages", async (c) =>
  c.json(sendMessage(c.req.param("id"), (await c.req.json<{ text?: unknown }>()).text), 201),
);

app.delete("/api/chats/:id/messages", (c) => {
  clearChat(c.req.param("id"));
  return c.json({ ok: true });
});

// Replies a Coordinator suggests (ADR 0010): the user sends them (edited or not) or dismisses them.
app.post("/api/suggestions/:id/send", async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  return c.json(await sendSuggestion(c.req.param("id"), body.text));
});
app.post("/api/suggestions/:id/dismiss", (c) => c.json(dismissSuggestion(c.req.param("id"))));
app.delete("/api/owners/:panelId", (c) => {
  clearOwner(c.req.param("panelId"));
  return c.json({ ok: true });
});
app.post("/api/handoffs/:id/cancel", (c) => {
  cancelHandoff(c.req.param("id"));
  return c.json({ ok: true });
});

// ---- static web build (production) ----
const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (existsSync(webDist)) {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", serveStatic({ path: join(webDist, "index.html") }));
}

