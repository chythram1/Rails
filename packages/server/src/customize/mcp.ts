// MCP servers for Sprockets (ADR 0025): the library Customize keeps, and the connections runs use. Rails is the MCP
// client (@earendil-works/pi-mcp): a local command over stdio, or a remote URL over Streamable HTTP. A connection
// opens when it's first needed and closes after IDLE_MS. Environment and header values, and the tokens of a remote
// server Rails signed in to (OAuth), live in RAILS_HOME/mcp-secrets.json (readable only by the user) and never leave
// the server.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpAuthRequiredError, McpClient, StdioTransport, StreamableHttpTransport, toLlmContent, type Tool } from "@earendil-works/pi-mcp";
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  OAuthError,
  OAuthRegistrationError,
  type McpOAuthState,
  type McpOAuthStateStore,
} from "@earendil-works/pi-mcp/oauth";
import {
  connectorById,
  type ConnectorInput,
  MCP_DESCRIPTION_MAX,
  MCP_NAME_MAX,
  MCP_TOOL_POLICIES,
  type McpApp,
  type McpAppId,
  type McpAppInput,
  type McpServer,
  type McpServerInput,
  type McpSignIn,
  type McpToolPolicy,
} from "@rails/shared";
import { MCP_OAUTH_PORT, RAILS_HOME } from "../config.ts";
import { customizeChanged } from "./customize.ts";
import { mcpServers, sprocketTools, type StoredMcpServer, type StoredTool } from "../db.ts";
import { ServiceError } from "../errors.ts";
import { pickFolder } from "../workspace/picker.ts";
import { awaitRedirect, type PendingSignIn } from "../settings/signin.ts";
import { cleanEnv } from "../workspace/tmux.ts";

/** A connection unused this long closes. */
const IDLE_MS = 5 * 60_000;
/** How long connecting (and listing the tools) may take. */
const CONNECT_MS = 20_000;
/** How long one tool call may take. */
const CALL_MS = 120_000;
/** A result is trimmed to this for the model (and for an approval card). */
export const RESULT_CHARS = 20_000;
const ARGS_MAX = 50;
const VALUE_MAX = 4000;

// ---- secrets ----

type Secrets = Record<
  string,
  {
    env?: Record<string, string>;
    headers?: Record<string, string>;
    /** The user's own app (OAuth client) with the service, for signing in. */
    client?: { id: string; secret?: string };
    /** Signing in (pi-mcp's state: the registered client, tokens, the sign-in under way), and the redirect it used. */
    oauth?: McpOAuthState;
    oauthRedirect?: string;
  }
>;
const secretsFile = () => join(RAILS_HOME, "mcp-secrets.json");
const readSecrets = (): Secrets => (existsSync(secretsFile()) ? (JSON.parse(readFileSync(secretsFile(), "utf8")) as Secrets) : {});
function writeSecrets(data: Secrets) {
  const tmp = secretsFile() + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, secretsFile());
}
const secretsOf = (id: string) => readSecrets()[id] ?? {};

// ---- shared apps: an app the user registers once with a service, for all its connectors (Google's) ----

const MCP_APPS: McpAppId[] = ["google"];
type Apps = Partial<Record<McpAppId, { id: string; secret?: string }>>;
const appsFile = () => join(RAILS_HOME, "mcp-apps.json");
const readApps = (): Apps => (existsSync(appsFile()) ? (JSON.parse(readFileSync(appsFile(), "utf8")) as Apps) : {});

/** A shared app as the browser sees it: its client ID and whether its secret is set. */
function appView(id: McpAppId): McpApp {
  const app = readApps()[id];
  return { id, ...(app ? { clientId: app.id } : {}), clientSecret: !!app?.secret, redirectUrl: redirectUrl() };
}
export const listApps = (): McpApp[] => MCP_APPS.map(appView);

/**
 * Set or change a shared app (a value sets, null removes). Servers that signed in with the old one are signed out:
 * their tokens and registration were for it.
 */
export async function setApp(id: string, body: McpAppInput | undefined): Promise<McpApp> {
  if (!MCP_APPS.includes(id as McpAppId)) throw new ServiceError("Not found", 404);
  const apps = readApps();
  const next = mergeClient(apps[id as McpAppId], body ?? {});
  if (next) apps[id as McpAppId] = next;
  else delete apps[id as McpAppId];
  const tmp = appsFile() + ".tmp";
  writeFileSync(tmp, JSON.stringify(apps, null, 2), { mode: 0o600 });
  renameSync(tmp, appsFile());
  for (const s of mcpServers.list()) if (appOf(s) === id && !secretsOf(s.id).client) await signOut(s.id);
  customizeChanged();
  return appView(id as McpAppId);
}

/** The shared app a server can sign in with: its connector's. */
const appOf = (s: StoredMcpServer): McpAppId | undefined => connectorById(s.connector)?.app;
/** The app a server signs in with: its own, else its connector's shared one, if set. */
const clientOf = (s: StoredMcpServer) => secretsOf(s.id).client ?? (appOf(s) ? readApps()[appOf(s)!] : undefined);

// ---- the library ----

/** A tool reads only if the server marks it so, or its connector's entry says all its tools do. */
const readsOnly = (server: StoredMcpServer, tool: StoredTool) => tool.readOnly || connectorById(server.connector)?.readOnly === true;
/** What a Sprocket may do with a tool: the user's choice, else allow for read-only tools and ask for the rest. */
export const policyOf = (server: StoredMcpServer, tool: StoredTool): McpToolPolicy => server.policies[tool.name] ?? (readsOnly(server, tool) ? "allow" : "ask");

function view(s: StoredMcpServer): McpServer {
  const secrets = secretsOf(s.id);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    transport: s.transport,
    command: s.command,
    args: s.args,
    url: s.url,
    env: Object.keys(secrets.env ?? {}).sort(),
    headers: Object.keys(secrets.headers ?? {}).sort(),
    tools: s.tools.map((t) => ({ name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description, readOnly: readsOnly(s, t), policy: policyOf(s, t) })),
    ...(s.toolsAt ? { toolsAt: s.toolsAt } : {}),
    status: s.status,
    usedBy: sprocketTools.users("mcp", s.id),
    ...(s.transport === "http" ? { signIn: signInView(s) } : {}),
    ...(s.connector ? { connector: s.connector } : {}),
    createdAt: s.createdAt,
  };
}

function getServer(id: string): StoredMcpServer {
  const s = mcpServers.get(id);
  if (!s) throw new ServiceError("Not found", 404);
  return s;
}

export const listServers = (): McpServer[] => mcpServers.list().map(view);

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;

const text = (v: unknown, label: string, max: number): string => {
  if (typeof v !== "string") throw new ServiceError(`${label} must be text`, 400);
  const t = v.trim();
  if (t.length > max) throw new ServiceError(`${label} can be at most ${max} characters.`, 400);
  if (CONTROL.test(t)) throw new ServiceError(`${label} can't hold control characters.`, 400);
  return t;
};

/** The server a request asks for, from what it has now: every field checked. */
function parseServer(b: McpServerInput, cur?: StoredMcpServer): Pick<StoredMcpServer, "name" | "description" | "transport" | "command" | "args" | "url" | "policies"> {
  const name = b.name === undefined ? (cur?.name ?? "") : text(b.name, "The name", MCP_NAME_MAX).toLowerCase();
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (!NAME.test(name)) throw new ServiceError("Names are lowercase letters, digits, - and _, starting with a letter or digit.", 400);
  const taken = mcpServers.byName(name);
  if (taken && taken.id !== cur?.id) throw new ServiceError(`There's already a server called ${name}.`, 409);
  const description = b.description === undefined ? (cur?.description ?? "") : text(b.description, "The description", MCP_DESCRIPTION_MAX);
  const transport = b.transport ?? cur?.transport ?? "stdio";
  if (transport !== "stdio" && transport !== "http") throw new ServiceError("Unknown transport", 400);
  const command = b.command === undefined ? (cur?.command ?? "") : text(b.command, "The command", 500);
  let args = cur?.args ?? [];
  if (b.args !== undefined) {
    if (!Array.isArray(b.args) || b.args.some((a) => typeof a !== "string")) throw new ServiceError("Arguments must be a list of texts", 400);
    if (b.args.length > ARGS_MAX) throw new ServiceError(`At most ${ARGS_MAX} arguments.`, 400);
    args = b.args.map((a) => text(a, "An argument", 1000)).filter(Boolean);
  }
  const url = b.url === undefined ? (cur?.url ?? "") : text(b.url, "The URL", 1000);
  if (transport === "http" && url) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ServiceError("That isn't a URL.", 400);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new ServiceError("The URL must start with https:// or http://.", 400);
  }
  const policies = { ...(cur?.policies ?? {}) };
  if (b.policies !== undefined) {
    if (typeof b.policies !== "object" || b.policies === null) throw new ServiceError("Tool settings must be an object", 400);
    for (const [tool, p] of Object.entries(b.policies)) {
      if (!MCP_TOOL_POLICIES.includes(p)) throw new ServiceError(`Unknown setting for ${tool}`, 400);
      if (!cur?.tools.some((t) => t.name === tool)) throw new ServiceError(`${cur?.name ?? "This server"} has no tool called ${tool}. Test it to list its tools again.`, 400);
      policies[tool] = p;
    }
  }
  return { name, description, transport, command, args, url, policies };
}

/** Environment or header values from a request merged into the stored ones: a value sets, null removes. */
function mergeValues(kind: "env" | "headers", stored: Record<string, string> | undefined, change: Record<string, string | null> | undefined): Record<string, string> {
  const out = { ...(stored ?? {}) };
  if (change === undefined) return out;
  if (typeof change !== "object" || change === null) throw new ServiceError("Values must be an object", 400);
  for (const [k, v] of Object.entries(change)) {
    if (!(kind === "env" ? ENV_NAME : HEADER_NAME).test(k)) throw new ServiceError(`${JSON.stringify(k)} isn't a valid ${kind === "env" ? "variable" : "header"} name.`, 400);
    if (kind === "env" && /^RAILS_/.test(k)) throw new ServiceError("Variables starting with RAILS_ are Rails' own.", 400);
    if (v === null) delete out[k];
    else out[k] = text(v, `The value of ${k}`, VALUE_MAX);
  }
  if (Object.keys(out).length > 30) throw new ServiceError("At most 30 values.", 400);
  return out;
}

/** The user's own app from a request, merged into the stored one: a value sets, null removes. */
function mergeClient(stored: { id: string; secret?: string } | undefined, b: McpServerInput): { id: string; secret?: string } | undefined {
  const id = b.clientId === undefined ? stored?.id : b.clientId === null ? undefined : text(b.clientId, "The client ID", 500) || undefined;
  const secret = b.clientSecret === undefined ? stored?.secret : b.clientSecret === null ? undefined : text(b.clientSecret, "The client secret", VALUE_MAX) || undefined;
  if (!id) {
    if (secret && b.clientSecret) throw new ServiceError("Give the client ID first.", 400);
    return undefined;
  }
  return { id, ...(secret ? { secret } : {}) };
}

/**
 * Store a request's secret values. A new URL or app ends the sign-in: its tokens were for the old one.
 */
function saveSecrets(id: string, b: McpServerInput, urlChanged = false) {
  const appChanged = b.clientId !== undefined || b.clientSecret !== undefined;
  if (b.env === undefined && b.headers === undefined && !appChanged && !urlChanged) return;
  const all = readSecrets();
  const cur = all[id] ?? {};
  const client = mergeClient(cur.client, b);
  const { oauth, oauthRedirect, ...rest } = cur;
  all[id] = {
    ...rest,
    env: mergeValues("env", cur.env, b.env),
    headers: mergeValues("headers", cur.headers, b.headers),
    ...(client ? { client } : { client: undefined }),
    ...(appChanged || urlChanged ? {} : { oauth, oauthRedirect }),
  };
  writeSecrets(all);
}

export function createServer(body: McpServerInput | undefined, connector?: string): McpServer {
  const b = body ?? {};
  const s = parseServer({ ...b, name: b.name ?? freeName() });
  // Check the values before anything is stored.
  mergeValues("env", undefined, b.env);
  mergeValues("headers", undefined, b.headers);
  mergeClient(undefined, b);
  const made = mcpServers.create({ ...s, ...(connector ? { connector } : {}) });
  saveSecrets(made.id, b);
  customizeChanged();
  return view(getServer(made.id));
}

/** "server", "server-2"…: the first free name. */
function freeName(base = "server"): string {
  for (let n = 1; ; n++) if (!mcpServers.byName(n === 1 ? base : `${base}-${n}`)) return n === 1 ? base : `${base}-${n}`;
}

/**
 * Add a connector (shared CONNECTORS): a server set up as its entry says (a token as a header, a folder from the
 * native picker, a data file of its own), then connected, or signed in to (its page to open comes back as
 * `signIn.authUrl`). One that needs the user's own app is only added; its page says what to do.
 */
export async function addConnector(connectorId: string, body: ConnectorInput | undefined): Promise<McpServer> {
  const c = connectorById(connectorId);
  if (!c) throw new ServiceError("Not found", 404);
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};
  let args = c.args ?? [];
  if (c.setup === "token" && c.token) {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) throw new ServiceError(`Paste the ${c.token.label.toLowerCase()} first.`, 400);
    headers[c.token.header] = c.token.prefix + token;
  }
  if (c.setup === "folder") {
    const folder = await pickFolder();
    if (!folder) throw new ServiceError("No folder was chosen.", 400);
    args = [...args, folder];
  }
  const name = freeName(c.id);
  const made = createServer(
    { name, description: c.description, transport: c.url ? "http" : "stdio", command: c.command ?? "", args, url: c.url ?? "", env, headers },
    c.id,
  );
  if (c.setup === "sign-in") return startSignIn(made.id);
  // With the shared app set up (Google's), it signs in like any other; without, its page says what to do.
  if (c.setup === "own-app") return c.app && readApps()[c.app] ? startSignIn(made.id) : made;
  return testServer(made.id);
}

export function updateServer(id: string, body: McpServerInput | undefined): McpServer {
  const cur = getServer(id);
  const b = body ?? {};
  const next = parseServer(b, cur);
  mergeValues("env", undefined, b.env);
  mergeValues("headers", undefined, b.headers);
  mergeClient(undefined, b);
  mcpServers.update(id, next);
  saveSecrets(id, b, next.url !== cur.url);
  // How it connects changed: the next use connects again.
  if (
    b.transport !== undefined ||
    b.command !== undefined ||
    b.args !== undefined ||
    b.url !== undefined ||
    b.env !== undefined ||
    b.headers !== undefined ||
    b.clientId !== undefined ||
    b.clientSecret !== undefined
  ) {
    if (signing?.serverId === id) void cancelSignIn(id);
    void disconnect(id);
  }
  customizeChanged();
  return view(getServer(id));
}

export function deleteServer(id: string): void {
  getServer(id);
  if (signing?.serverId === id) void cancelSignIn(id);
  signInErrors.delete(id);
  void disconnect(id);
  mcpServers.remove(id);
  const all = readSecrets();
  if (all[id]) {
    delete all[id];
    writeSecrets(all);
  }
  customizeChanged();
}

/** Connect now (again), list its tools and keep them: Customize's Test. */
export async function testServer(id: string): Promise<McpServer> {
  getServer(id);
  await disconnect(id);
  try {
    await connection(id);
  } catch {
    // its status says why
  }
  return view(getServer(id));
}

// ---- connections ----

type Live = { client: McpClient; idle?: ReturnType<typeof setTimeout> };
const live = new Map<string, Live>();
const connecting = new Map<string, Promise<Live>>();

function transportOf(s: StoredMcpServer) {
  const secrets = secretsOf(s.id);
  if (s.transport === "http") {
    if (!s.url) throw new Error("It has no URL yet.");
    // Signed in: the token goes with every request and is renewed when the service turns it away.
    const authProvider = signedIn(s) ? adaptOAuthProvider(oauthProvider(s)) : undefined;
    return new StreamableHttpTransport({ url: s.url, headers: secrets.headers ?? {}, ...(authProvider ? { authProvider } : {}) });
  }
  if (!s.command) throw new Error("It has no command yet.");
  // The environment panels get (no RAILS_* or the access token), plus its own; run from the user's home.
  return new StdioTransport({ command: s.command, args: s.args, env: { ...cleanEnv(), ...(secrets.env ?? {}) }, inheritEnv: false, cwd: homedir(), stderr: "pipe" });
}

const toolOf = (t: Tool): StoredTool => ({
  name: t.name,
  ...(t.title ?? t.annotations?.title ? { title: t.title ?? t.annotations?.title } : {}),
  description: (t.description ?? "").slice(0, 2000),
  inputSchema: t.inputSchema ?? { type: "object" },
  readOnly: t.annotations?.readOnlyHint === true,
  // Only when it says so: MCP's default (destructive unless marked otherwise) would ask twice for every write.
  ...(t.annotations?.destructiveHint === true && t.annotations?.readOnlyHint !== true ? { destructive: true } : {}),
});

/** A connection to the server, opened (and its tools listed and kept) if there's none. */
async function connection(id: string): Promise<Live> {
  const open = live.get(id);
  if (open && open.client.connectionState === "connected") return touch(id, open);
  const pending = connecting.get(id);
  if (pending) return pending;
  const attempt = (async () => {
    const s = getServer(id);
    const client = new McpClient({ name: "Rails", version: "1.0.0", requestTimeoutMs: CALL_MS });
    let transport: ReturnType<typeof transportOf> | undefined;
    try {
      transport = transportOf(s);
      const timeout = AbortSignal.timeout(CONNECT_MS);
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => timeout.addEventListener("abort", () => reject(new Error(`It didn't answer within ${CONNECT_MS / 1000} seconds.`)))),
      ]);
      const tools = await client.listTools({ timeoutMs: CONNECT_MS });
      mcpServers.setTools(id, tools.map(toolOf));
      mcpServers.setStatus(id, { state: "ok", at: new Date().toISOString() });
      const conn: Live = { client };
      client.onClose(() => {
        if (live.get(id) === conn) live.delete(id);
      });
      live.set(id, conn);
      customizeChanged();
      return touch(id, conn);
    } catch (e) {
      void client.close().catch(() => {});
      const stderr = transport instanceof StdioTransport ? transport.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300) : "";
      const error = needsSignIn(e) ? SIGN_IN_NEEDED : `${(e as Error).message}${stderr ? ` (it said: ${stderr})` : ""}`.slice(0, 500);
      mcpServers.setStatus(id, { state: "error", error, at: new Date().toISOString() });
      customizeChanged();
      throw new Error(error);
    }
  })().finally(() => connecting.delete(id));
  connecting.set(id, attempt);
  return attempt;
}

function touch(id: string, conn: Live): Live {
  if (conn.idle) clearTimeout(conn.idle);
  conn.idle = setTimeout(() => void disconnect(id), IDLE_MS);
  conn.idle.unref?.();
  return conn;
}

async function disconnect(id: string): Promise<void> {
  const conn = live.get(id);
  live.delete(id);
  if (!conn) return;
  if (conn.idle) clearTimeout(conn.idle);
  await conn.client.close().catch(() => {});
}

/** Close every connection (the server is stopping, or a test ends). */
export async function disconnectAll(): Promise<void> {
  await Promise.all([...live.keys()].map(disconnect));
}

/**
 * The servers a run can use, with their tools: those listed before, and for one never listed, a connection now
 * (a failure is reported, not thrown).
 */
export async function serversFor(ids: string[]): Promise<{ server: StoredMcpServer; error?: string }[]> {
  return Promise.all(
    ids.flatMap((id) => {
      const s = mcpServers.get(id);
      if (!s) return [];
      if (s.toolsAt) return [Promise.resolve({ server: s })];
      return [
        connection(id).then(
          () => ({ server: mcpServers.get(id)! }),
          (e: Error) => ({ server: mcpServers.get(id) ?? s, error: e.message }),
        ),
      ];
    }),
  );
}

/**
 * Call a tool. The result as text for a model (images as a placeholder), trimmed to RESULT_CHARS, and whether the
 * server reported it as a failure.
 */
export async function callTool(serverId: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
  const conn = await connection(serverId);
  try {
    const result = await conn.client.callTool(tool, args, { signal, timeoutMs: CALL_MS }).catch((e: unknown) => {
      // Some services list their tools to anyone but want a sign-in for calls (or the sign-in ran out).
      if (!needsSignIn(e)) throw e;
      mcpServers.setStatus(serverId, { state: "error", error: SIGN_IN_NEEDED, at: new Date().toISOString() });
      customizeChanged();
      throw new Error(`${mcpServers.get(serverId)?.name ?? "The server"} needs the user to sign in to it (in Customize) before its tools work.`);
    });
    const text = toLlmContent(result)
      .map((c) => (c.type === "text" ? c.text : "[an image]"))
      .join("\n")
      .trim();
    return { text: text.length > RESULT_CHARS ? `${text.slice(0, RESULT_CHARS)}\n[…cut from ${text.length} characters]` : text || "(no output)", isError: result.isError === true };
  } finally {
    touch(serverId, conn);
  }
}

// ---- signing in (OAuth) ----
//
// A remote server may want the user to sign in. pi-mcp does the OAuth: it finds the service's sign-in server, registers
// Rails with it (or uses the user's own app), and renews tokens. The browser comes back to a listener on this computer's
// 127.0.0.1 (signin.ts' awaitRedirect, as for ChatGPT); on another device that page won't load, so the user pastes its
// address instead. One sign-in runs at a time, since they share the port.

const CALLBACK_PATH = "/mcp/oauth/callback";
/** The status of a server that turned Rails away until someone signs in. */
export const SIGN_IN_NEEDED = "It needs you to sign in.";
const redirectUrl = () => `http://127.0.0.1:${MCP_OAUTH_PORT}${CALLBACK_PATH}`;

type Signing = { serverId: string; authUrl: string; pending: PendingSignIn<void>; cancelled?: boolean };
let signing: Signing | undefined;
/** Why a server's last sign-in failed, until the next one starts. */
const signInErrors = new Map<string, string>();

const needsSignIn = (e: unknown) => e instanceof McpAuthRequiredError || e instanceof McpOAuthAuthorizationRequiredError;

/** pi-mcp's sign-in state for a server, kept with its secrets. */
function oauthStore(id: string): McpOAuthStateStore {
  return {
    load: () => secretsOf(id).oauth,
    save(state) {
      const all = readSecrets();
      all[id] = { ...(all[id] ?? {}), oauth: state };
      writeSecrets(all);
    },
  };
}

function oauthProvider(s: StoredMcpServer, onRedirect: (url: URL) => void = () => {}) {
  const client = clientOf(s);
  return new McpOAuthProvider({
    serverUrl: s.url,
    redirectUrl: redirectUrl(),
    clientMetadata: { client_name: "Rails", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    ...(client ? { clientId: client.id, ...(client.secret ? { clientSecret: client.secret } : {}) } : {}),
    store: oauthStore(s.id),
    onRedirect,
  });
}

/** Whether Rails holds a token for the server's URL as it is now. */
function signedIn(s: StoredMcpServer): boolean {
  const oauth = secretsOf(s.id).oauth;
  if (!oauth?.tokens || !s.url) return false;
  try {
    return oauth.serverUrl === String(new URL(s.url));
  } catch {
    return false;
  }
}

function signInView(s: StoredMcpServer): McpSignIn {
  const client = secretsOf(s.id).client;
  const error = signInErrors.get(s.id);
  return {
    state: signedIn(s) ? "signed-in" : s.status.state === "error" && s.status.error === SIGN_IN_NEEDED ? "needed" : "none",
    ...(signing?.serverId === s.id ? { authUrl: signing.authUrl } : {}),
    ...(error ? { error } : {}),
    ...(client ? { clientId: client.id } : {}),
    clientSecret: !!client?.secret,
    redirectUrl: redirectUrl(),
    ...(appOf(s) ? { app: appOf(s) } : {}),
  };
}

/** What went wrong signing in, in words. */
function signInError(e: unknown): string {
  if (e instanceof OAuthRegistrationError || (e instanceof Error && /dynamic client registration/.test(e.message)))
    return "This service doesn't let apps register themselves. Register an app with it, then enter its client ID (and secret) under Your own app.";
  if (e instanceof OAuthError) return `The service said: ${e.message}`;
  return (e as Error).message;
}

/** Start signing in: the page to open comes back as the server's `signIn.authUrl`. */
export async function startSignIn(id: string): Promise<McpServer> {
  const s = getServer(id);
  if (s.transport !== "http" || !s.url) throw new ServiceError("Only a server with a URL signs in.", 400);
  if (signing) await cancelSignIn(signing.serverId);
  signInErrors.delete(id);
  // A fresh state and verifier each time; an app registered for another redirect address registers again.
  const all = readSecrets();
  const cur = all[id] ?? {};
  if (cur.oauth) {
    const { oauthState: _s, codeVerifier: _v, ...rest } = cur.oauth;
    cur.oauth = cur.oauthRedirect === redirectUrl() ? rest : { ...rest, clientInformation: undefined };
  }
  all[id] = { ...cur, oauthRedirect: redirectUrl() };
  writeSecrets(all);

  let authUrl: URL | undefined;
  try {
    const result = await authorizeMcp(oauthProvider(s, (url) => (authUrl = url)), { serverUrl: s.url, skipRefresh: true, signal: AbortSignal.timeout(CONNECT_MS) });
    if (result === "AUTHORIZED" || !authUrl) {
      await testServer(id);
      return view(getServer(id));
    }
  } catch (e) {
    signInErrors.set(id, signInError(e));
    customizeChanged();
    return view(getServer(id));
  }
  const expected = secretsOf(id).oauth?.oauthState;
  let pending: PendingSignIn<void>;
  try {
    pending = await awaitRedirect<{ code: string; iss?: string }, void>({
      port: MCP_OAUTH_PORT,
      path: CALLBACK_PATH,
      authUrl: () => authUrl!.href,
      busy: `Port ${MCP_OAUTH_PORT} is busy, maybe with another Rails signing in to a server. Finish that one, or start Rails with another RAILS_MCP_OAUTH_PORT.`,
      read(url) {
        if (!expected || url.searchParams.get("state") !== expected) throw new Error("That address is from another sign-in.");
        const code = url.searchParams.get("code");
        if (!code) throw new Error("That address has no sign-in code. Paste the whole address.");
        const iss = url.searchParams.get("iss");
        return { code, ...(iss ? { iss } : {}) };
      },
      async exchange({ code, iss }) {
        const server = getServer(id);
        const result = await authorizeMcp(oauthProvider(server), { serverUrl: server.url, authorizationCode: code, ...(iss ? { iss } : {}), signal: AbortSignal.timeout(CONNECT_MS) }).catch((e) => {
          throw new Error(signInError(e));
        });
        if (result !== "AUTHORIZED") throw new Error("The service didn't give Rails a token. Try again.");
      },
    });
  } catch (e) {
    signInErrors.set(id, (e as Error).message);
    customizeChanged();
    return view(getServer(id));
  }
  const active: Signing = { serverId: id, authUrl: authUrl.href, pending };
  signing = active;
  pending.credential.then(
    async () => {
      if (signing === active) signing = undefined;
      await testServer(id).catch(() => {}); // lists its tools; its status says if that failed
      customizeChanged();
    },
    (e: Error) => {
      if (signing === active) signing = undefined;
      if (!active.cancelled && mcpServers.get(id)) signInErrors.set(id, e.message);
      customizeChanged();
    },
  );
  customizeChanged();
  return view(getServer(id));
}

/** The address the browser landed on after signing in, pasted by the user (signing in from another device). */
export async function pasteSignIn(id: string, address: unknown): Promise<McpServer> {
  getServer(id);
  if (typeof address !== "string" || !address.trim()) throw new ServiceError("Paste the address from your browser.", 400);
  if (signing?.serverId !== id) throw new ServiceError("No sign-in is waiting for this server. Start it again.", 409);
  try {
    await signing.pending.paste(address);
  } catch (e) {
    throw new ServiceError((e as Error).message, 400);
  }
  await signing?.pending.credential.catch(() => {});
  return view(getServer(id));
}

export async function cancelSignIn(id: string): Promise<void> {
  const active = signing;
  if (!active || active.serverId !== id) return;
  active.cancelled = true;
  signing = undefined;
  await active.pending.close();
  customizeChanged();
}

/** Forget the tokens and the registered app; the service may still list Rails among its connected apps. */
export async function signOut(id: string): Promise<McpServer> {
  getServer(id);
  await cancelSignIn(id);
  signInErrors.delete(id);
  const all = readSecrets();
  if (all[id]?.oauth) {
    const { oauth: _o, oauthRedirect: _r, ...rest } = all[id];
    all[id] = rest;
    writeSecrets(all);
  }
  await disconnect(id);
  mcpServers.setStatus(id, { state: "unknown" });
  customizeChanged();
  return view(getServer(id));
}
