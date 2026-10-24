// Signing in to a model provider (ADR 0006): "Continue with ChatGPT" and OpenRouter's sign-in. Rails runs
// these flows itself, so every page the user sees says Rails. The credential it stores has exactly the
// shape pi-ai's own sign-in produces, so pi-ai keeps refreshing tokens and making the requests.
// signin.test.ts checks that contract against the installed pi-ai: run it after upgrading pi-ai.
//
// The flows follow pi-ai 1.3 (dist/auth/oauth/openai-chatgpt.js, openrouter.js) and the providers' docs
// (OpenAI: developers.openai.com/siwc). The provider sends the browser back to a one-off server on this
// machine's 127.0.0.1. A browser on another device can't reach that, so the user pastes the address the
// browser landed on instead (`paste`).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthCredential } from "@earendil-works/pi-ai";

/** A sign-in waiting for the browser to come back from the provider. */
export interface PendingSignIn<C = OAuthCredential> {
  /** The provider's page the user opens to sign in. */
  authUrl: string;
  /** Resolves with the credential once the browser comes back; rejects if the sign-in fails or times out. */
  credential: Promise<C>;
  /** The address the browser landed on, pasted by the user. Rejects if it's wrong; the sign-in goes on. */
  paste(address: string): Promise<void>;
  /** Stop waiting and free the port. */
  close(): Promise<void>;
}

const TIMEOUT_MS = 10 * 60_000;

const random = () => randomBytes(32).toString("base64url");

function pkce() {
  const verifier = random();
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** A failure the sign-in can't recover from (the user declined, the code was used up). */
class Fatal extends Error {}

/**
 * Listen on 127.0.0.1:`port` (0 = any free port) for the provider's redirect to `path`, and accept the same
 * address pasted by the user. `read` checks an address and pulls out what `exchange` needs; a bad address
 * (a stray request, a wrong paste) is turned away and the sign-in goes on. The first good address is
 * exchanged once for the credential. MCP servers' sign-ins use it too (mcp.ts), with `busy` saying who else may
 * hold the port.
 */
export async function awaitRedirect<T, C = OAuthCredential>(opts: {
  port: number;
  path: string;
  authUrl(redirectUri: string): string;
  read(url: URL): T;
  exchange(value: T, redirectUri: string): Promise<C>;
  busy?: string;
}): Promise<PendingSignIn<C>> {
  let resolve!: (c: C) => void;
  let reject!: (e: Error) => void;
  const credential = new Promise<C>((res, rej) => ((resolve = res), (reject = rej)));
  credential.catch(() => {}); // the caller may stop listening first
  let exchanging: Promise<void> | undefined;
  let settled = false;

  const complete = (url: URL): Promise<void> => {
    if (settled) return Promise.reject(new Error("This sign-in is already finished."));
    const declined = url.searchParams.get("error");
    if (declined) {
      const why = url.searchParams.get("error_description") ?? declined;
      fail(new Fatal(`The sign-in was declined (${why}).`));
      return Promise.reject(new Error(`The sign-in was declined (${why}).`));
    }
    let value: T;
    try {
      value = opts.read(url);
    } catch (e) {
      return Promise.reject(e);
    }
    // The code works once; a second request for it (a browser retry) waits for the first.
    exchanging ??= opts.exchange(value, redirectUri).then(
      (c) => {
        settled = true;
        resolve(c);
        void close();
      },
      (e: Error) => {
        fail(new Fatal(e.message));
        throw e;
      },
    );
    return exchanging;
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== opts.path) return page(res, 404, "Not found", "This isn't a Rails sign-in address.");
    complete(url).then(
      () => page(res, 200, "You're signed in", "Rails can use your account now. You can close this tab."),
      (e: Error) => page(res, 400, "The sign-in didn't finish", e.message),
    );
  });
  await new Promise<void>((ok, bad) => {
    server.once("error", (e: NodeJS.ErrnoException) =>
      bad(
        e.code === "EADDRINUSE"
          ? new Error(opts.busy ?? `Port ${opts.port} is busy, probably with another sign-in (Codex or pi use it too). Finish or cancel that one, then try again.`)
          : e,
      ),
    );
    server.listen(opts.port, "127.0.0.1", ok);
  });
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}${opts.path}`;

  const timer = setTimeout(() => fail(new Fatal("The sign-in timed out. Start it again.")), TIMEOUT_MS);
  // Stops listening at once, so the port is free for the next sign-in. Browsers keep spare connections
  // open, and a later sign-in's redirect could arrive on one of them and be turned away here, so idle
  // ones are dropped; a request being answered finishes (its page closes its connection).
  const close = async () => {
    clearTimeout(timer);
    if (!server.listening) return;
    const closed = new Promise((done) => server.close(done));
    server.closeIdleConnections();
    await Promise.race([closed, new Promise((done) => setTimeout(done, 200))]);
  };
  function fail(e: Error) {
    if (settled) return;
    settled = true;
    reject(e);
    void close();
  }

  return {
    authUrl: opts.authUrl(redirectUri),
    credential,
    close: async () => {
      fail(new Fatal("The sign-in was cancelled."));
      await close();
    },
    paste(address: string) {
      let url: URL;
      try {
        url = new URL(address.trim());
      } catch {
        return Promise.reject(new Error("Paste the whole address from your browser's address bar."));
      }
      if (url.origin + url.pathname !== new URL(redirectUri).origin + opts.path)
        return Promise.reject(new Error(`That's not the address from this sign-in. It starts with http://127.0.0.1:${port}/.`));
      return complete(url);
    },
  };
}

// ---- Continue with ChatGPT (OpenAI's "Sign in with ChatGPT" with plan usage) ----

const OPENAI_AUTHORIZE = "https://auth.openai.com/api/accounts/authorize";
const OPENAI_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
const OPENAI_RESOURCE = "https://api.openai.com/v1";
/** OpenAI only accepts this redirect, so the port is fixed (the Codex CLI and pi use it too). */
const CHATGPT_PORT = 1455;
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
/** Treat tokens as expired this long before they are, so a request never starts with one about to lapse. */
const EXPIRY_MARGIN_MS = 3 * 60_000;

/**
 * `deviceId` identifies this install to OpenAI (a UUID, kept across sign-ins). The first sign-in registers
 * Rails with the user's ChatGPT account, and OpenAI asks the user to name it. Later sign-ins pass the
 * client id that registration issued (`clientId`), which skips the naming and consent screens; it only
 * works for the same ChatGPT account. `port` is for tests.
 */
export function signInWithChatGPT(deviceId: string, opts: { clientId?: string; port?: number } = {}): Promise<PendingSignIn> {
  const { verifier, challenge } = pkce();
  const state = random();
  const reuse = opts.clientId;
  return awaitRedirect({
    port: opts.port ?? CHATGPT_PORT,
    path: "/auth/callback",
    authUrl: (redirectUri) =>
      `${OPENAI_AUTHORIZE}?${new URLSearchParams({
        // A first sign-in registers a client (OpenAI returns its id with the redirect) under a name the user
        // can edit; signing in again reuses that id, with no name.
        ...(reuse ? { client_id: reuse } : { client_id: "dynamic_agent_client", agent_name_hint: "Rails" }),
        ext_agent_host_id: `urn:uuid:${deviceId.toLowerCase()}`,
        response_type: "code",
        redirect_uri: redirectUri,
        resource: OPENAI_RESOURCE,
        scope: `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        nonce: random(),
      })}`,
    read(url) {
      const code = url.searchParams.get("code");
      const clientId = url.searchParams.get("client_id")?.trim() || reuse;
      if (!code) throw new Error("That address has no sign-in code.");
      if (url.searchParams.get("state") !== state) throw new Error("That address is from a different sign-in.");
      if (!clientId) throw new Error("That address has no client id from OpenAI.");
      return { code, clientId };
    },
    async exchange({ code, clientId }, redirectUri) {
      const res = await fetch(OPENAI_TOKEN, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: OPENAI_RESOURCE }),
      });
      if (!res.ok) throw new Error(`OpenAI turned down the sign-in (${res.status}): ${(await res.text().catch(() => "")) || res.statusText}`);
      const t = (await res.json()) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
      const access = str(t.access_token);
      const refresh = str(t.refresh_token);
      const scopes = str(t.scope)?.split(/\s+/).filter(Boolean) ?? [];
      if (!access || !refresh || !str(t.id_token) || typeof t.expires_in !== "number" || t.expires_in <= 0)
        throw new Error("OpenAI sent an incomplete sign-in response.");
      if (!scopes.includes(PLAN_SCOPE)) throw new Error("OpenAI didn't allow using your ChatGPT plan (Plus or Pro is needed).");
      // The shape pi-ai's ChatGPT sign-in stores; its refresh needs `clientId`.
      return { type: "oauth", access, refresh, expires: Date.now() + t.expires_in * 1000 - EXPIRY_MARGIN_MS, clientId, scopes };
    },
  });
}

// ---- OpenRouter (its sign-in mints an API key the user controls) ----

export function signInWithOpenRouter(): Promise<PendingSignIn> {
  const { verifier, challenge } = pkce();
  return awaitRedirect({
    port: 0,
    // OpenRouter sends no `state`; a random path keeps stray requests from finishing the sign-in.
    path: `/oauth/callback/${random()}`,
    authUrl: (redirectUri) =>
      `https://openrouter.ai/auth?${new URLSearchParams({ callback_url: redirectUri, code_challenge: challenge, code_challenge_method: "S256" })}`,
    read(url) {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("That address has no sign-in code.");
      return code;
    },
    async exchange(code) {
      const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { key?: unknown };
      if (!res.ok || typeof body.key !== "string" || !body.key) throw new Error(`OpenRouter turned down the sign-in (${res.status}).`);
      // The shape pi-ai's OpenRouter sign-in stores: a permanent key, nothing to refresh.
      return { type: "oauth", access: body.key, refresh: "", expires: Number.MAX_SAFE_INTEGER };
    },
  });
}

// ---- the page the browser lands on ----

const logo = (() => {
  try {
    const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../web/src/assets/logo.svg"), "utf8");
    return svg.replace("<svg ", '<svg aria-hidden="true" ');
  } catch {
    return "";
  }
})();

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", connection: "close" });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Rails</title>
<style>
  /* The app's canvas, ink and muted colours (styles.css), light or dark like the device. */
  html { color-scheme: light dark; --bg: #ffffff; --text: #171717; --muted: #6b6b6b; }
  @media (prefers-color-scheme: dark) { html { --bg: #1d1d1d; --text: #f8f8f3; --muted: #a6a6a1; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box;
    background: var(--bg); color: var(--text); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; }
  main { max-width: 420px; }
  svg { width: 132px; height: auto; margin-bottom: 4px; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 8px; }
  p { margin: 0; color: var(--muted); }
</style></head>
<body><main>${logo}<h1>${escape(title)}</h1><p>${escape(body)}</p></main></body></html>`);
}
