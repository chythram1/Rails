import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithChatGPT, signInWithOpenRouter, type PendingSignIn } from "./signin.ts";

// Provider endpoints are faked; requests to the local callback server go through for real.
const realFetch = globalThis.fetch;
let calls: { url: string; body: string }[] = [];
let reply: (url: string) => Response;

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    calls.push({ url, body: String(init?.body ?? "") });
    return reply(url);
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tokens = (extra: object = {}) =>
  json({ access_token: "acc-1", refresh_token: "ref-1", id_token: "id-1", expires_in: 3600, scope: "openid resource.invoke chatgpt.tokens.use.direct", ...extra });

const device = "123e4567-e89b-12d3-a456-426614174000";
/** The address OpenAI would send the browser back to. */
function redirect(s: PendingSignIn, params: Record<string, string>) {
  const auth = new URL(s.authUrl);
  const url = new URL(auth.searchParams.get("redirect_uri") ?? auth.searchParams.get("callback_url")!);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}
const stateOf = (s: PendingSignIn) => new URL(s.authUrl).searchParams.get("state")!;

describe("Continue with ChatGPT", () => {
  it("asks OpenAI for plan usage as Rails, and stores pi-ai's credential shape", async () => {
    reply = () => tokens();
    const s = await signInWithChatGPT(device, { port: 0 });
    const auth = new URL(s.authUrl);
    expect(auth.origin + auth.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(auth.searchParams.get("agent_name_hint")).toBe("Rails");
    expect(auth.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(auth.searchParams.get("ext_agent_host_id")).toBe(`urn:uuid:${device}`);
    expect(auth.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");

    const page = await fetch(redirect(s, { code: "c1", state: stateOf(s), client_id: "oaiapp_1" }));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Rails can use your account");
    const c = await s.credential;
    expect(c).toMatchObject({ type: "oauth", access: "acc-1", refresh: "ref-1", clientId: "oaiapp_1" });
    expect(c.expires).toBeGreaterThan(Date.now());
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("oaiapp_1");
    expect(body.get("code")).toBe("c1");
  });

  it("turns away a stray request or a wrong paste, then accepts the right one", async () => {
    reply = () => tokens();
    const s = await signInWithChatGPT(device, { port: 0 });
    expect((await fetch(redirect(s, { code: "c1", state: "other", client_id: "x" }))).status).toBe(400);
    await expect(s.paste("not an address")).rejects.toThrow("Paste the whole address");
    await expect(s.paste("http://127.0.0.1:1/elsewhere?code=1")).rejects.toThrow("not the address");
    await s.paste(redirect(s, { code: "c2", state: stateOf(s), client_id: "oaiapp_2" }).toString());
    expect((await s.credential).clientId).toBe("oaiapp_2");
  });

  it("fails when the user declines or the plan can't be used", async () => {
    reply = () => tokens();
    const declined = await signInWithChatGPT(device, { port: 0 });
    await fetch(redirect(declined, { error: "access_denied" }));
    await expect(declined.credential).rejects.toThrow("declined");

    reply = () => tokens({ scope: "openid" });
    const noPlan = await signInWithChatGPT(device, { port: 0 });
    await expect(noPlan.paste(redirect(noPlan, { code: "c", state: stateOf(noPlan), client_id: "x" }).toString())).rejects.toThrow("Plus or Pro");
    await expect(noPlan.credential).rejects.toThrow("Plus or Pro");
  });

  it("signs in again with the issued client id, skipping OpenAI's naming step", async () => {
    reply = () => tokens();
    const s = await signInWithChatGPT(device, { clientId: "oaiapp_7", port: 0 });
    const auth = new URL(s.authUrl);
    expect(auth.searchParams.get("client_id")).toBe("oaiapp_7");
    expect(auth.searchParams.has("agent_name_hint")).toBe(false);
    // On a repeat sign-in the redirect may not carry the client id again.
    await fetch(redirect(s, { code: "c", state: stateOf(s) }));
    expect((await s.credential).clientId).toBe("oaiapp_7");
    expect(new URLSearchParams(calls[0].body).get("client_id")).toBe("oaiapp_7");
  });

  it("can be cancelled", async () => {
    const s = await signInWithChatGPT(device, { port: 0 });
    await s.close();
    await expect(s.credential).rejects.toThrow("cancelled");
  });

  // The contract with pi-ai: if an upgrade changes its credential shape, this fails.
  it("produces a credential pi-ai can use and refresh", async () => {
    reply = () => tokens();
    const s = await signInWithChatGPT(device, { port: 0 });
    await fetch(redirect(s, { code: "c", state: stateOf(s), client_id: "oaiapp_9" }));
    const credential = await s.credential;
    const oauth = openaiProvider().auth.oauth!;
    expect((await oauth.toAuth(credential)).apiKey).toBe("acc-1");

    calls = [];
    reply = () => tokens({ access_token: "acc-2", refresh_token: "ref-2" });
    const refreshed = await oauth.refresh(credential, new AbortController().signal);
    expect(refreshed).toMatchObject({ type: "oauth", access: "acc-2", refresh: "ref-2", clientId: "oaiapp_9" });
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("oaiapp_9");
    expect(body.get("refresh_token")).toBe("ref-1");
  });
});

describe("OpenRouter sign-in", () => {
  it("exchanges the code for a key that pi-ai uses as the API key", async () => {
    reply = () => json({ key: "sk-or-1" });
    const s = await signInWithOpenRouter();
    expect(new URL(s.authUrl).origin).toBe("https://openrouter.ai");
    expect((await fetch(redirect(s, { code: "c1" }))).status).toBe(200);
    const credential = await s.credential;
    expect(JSON.parse(calls[0].body)).toMatchObject({ code: "c1", code_challenge_method: "S256" });
    expect((await openrouterProvider().auth.oauth!.toAuth(credential)).apiKey).toBe("sk-or-1");
  });

  it("ignores requests to other paths on its port", async () => {
    const s = await signInWithOpenRouter();
    const other = new URL(redirect(s, { code: "c" }));
    other.pathname = "/oauth/callback/guess";
    expect((await fetch(other)).status).toBe(404);
    await s.close();
  });
});
