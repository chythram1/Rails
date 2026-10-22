// A remote MCP server that wants a sign-in (OAuth), for tests: protected resource and authorization server
// metadata, dynamic client registration (optional), an authorize page that approves at once, a token endpoint
// with PKCE and refresh tokens, and a Streamable HTTP endpoint (JSON answers) with one tool, `whoami`. With
// `openList`, listing the tools needs no sign-in but calling one does.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface FakeOAuthMcp {
  url: string;
  /** Turn away every access token handed out so far (the next request has to refresh). */
  expireTokens(): void;
  /** Clients registered dynamically. */
  registered: number;
  close(): Promise<void>;
}

export async function fakeOAuthMcp(opts: { registration?: boolean; clientId?: string; clientSecret?: string; openList?: boolean } = {}): Promise<FakeOAuthMcp> {
  const codes = new Map<string, { challenge: string; redirect: string; clientId: string }>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const clients = new Set<string>(opts.clientId ? [opts.clientId] : []);
  let base = "";
  const state = { registered: 0 };

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const body = async (req: IncomingMessage) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    return text;
  };
  const issue = () => {
    const token = { access_token: "at-" + randomBytes(8).toString("hex"), refresh_token: "rt-" + randomBytes(8).toString("hex") };
    access.add(token.access_token);
    refresh.add(token.refresh_token);
    return { ...token, token_type: "Bearer", expires_in: 3600 };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;
    if (req.method === "GET" && path.startsWith("/.well-known/oauth-protected-resource"))
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ["notes"] });
    if (req.method === "GET" && path === "/.well-known/oauth-authorization-server")
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(opts.registration === false ? {} : { registration_endpoint: `${base}/register` }),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    if (req.method === "POST" && path === "/register") {
      const meta = JSON.parse(await body(req));
      const clientId = "client-" + randomBytes(4).toString("hex");
      clients.add(clientId);
      state.registered++;
      return json(res, 201, { ...meta, client_id: clientId });
    }
    if (req.method === "GET" && path === "/authorize") {
      const q = url.searchParams;
      if (!clients.has(q.get("client_id") ?? "")) return json(res, 400, { error: "invalid_client" });
      const code = "code-" + randomBytes(8).toString("hex");
      codes.set(code, { challenge: q.get("code_challenge") ?? "", redirect: q.get("redirect_uri") ?? "", clientId: q.get("client_id")! });
      const back = new URL(q.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state") ?? "");
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (req.method === "POST" && path === "/token") {
      const p = new URLSearchParams(await body(req));
      if (opts.clientSecret && p.get("client_secret") !== opts.clientSecret) return json(res, 401, { error: "invalid_client" });
      if (p.get("grant_type") === "authorization_code") {
        const c = codes.get(p.get("code") ?? "");
        codes.delete(p.get("code") ?? "");
        const verifier = p.get("code_verifier") ?? "";
        if (!c || c.redirect !== p.get("redirect_uri") || createHash("sha256").update(verifier).digest("base64url") !== c.challenge)
          return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, issue());
      }
      if (p.get("grant_type") === "refresh_token") {
        if (!refresh.delete(p.get("refresh_token") ?? "")) return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, issue());
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/mcp") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      // `openList`: anyone may connect and list the tools; calling one needs a sign-in.
      const peek = opts.openList && req.method === "POST" ? JSON.parse(await body(req)) : undefined;
      if (!access.has(token) && !(peek && peek.method !== "tools/call"))
        return json(res, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      if (req.method === "GET") {
        res.writeHead(405);
        return res.end();
      }
      if (req.method === "DELETE") {
        res.writeHead(200);
        return res.end();
      }
      const msg = peek ?? JSON.parse(await body(req));
      if (msg.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      const reply = (result: unknown) => json(res, 200, { jsonrpc: "2.0", id: msg.id, result });
      if (msg.method === "initialize") return reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-oauth", version: "1" } });
      if (msg.method === "tools/list")
        return reply({ tools: [{ name: "whoami", description: "Say who's signed in.", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] });
      if (msg.method === "tools/call") return reply({ content: [{ type: "text", text: "Signed in to the fake service." }] });
      return json(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Unknown method" } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url: `${base}/mcp`,
    expireTokens: () => access.clear(),
    get registered() {
      return state.registered;
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
