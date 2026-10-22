// Signing in to remote MCP servers (OAuth, ADR 0025): discovery and registration through pi-mcp, the browser coming
// back to Rails' listener or a pasted address, tokens kept on the server and renewed, the user's own app, signing out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RAILS_MCP_OAUTH_PORT = String(20000 + Math.floor(Math.random() * 30000));
});

const { RAILS_HOME } = await import("./config.ts");
const mcp = await import("./mcp.ts");
const { fakeOAuthMcp } = await import("./test/fake-oauth-mcp.ts");

afterAll(() => mcp.disconnectAll());

/** What the service's authorize page sends the browser to (it approves at once). */
async function approve(authUrl: string): Promise<string> {
  const res = await fetch(authUrl, { redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) throw new Error(`authorize answered ${res.status}: ${await res.text()}`);
  return location;
}

const view = (id: string) => mcp.listServers().find((s) => s.id === id)!;

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 30));
  expect(check()).toBe(true);
}

describe("signing in to MCP servers", () => {
  it("signs in through the browser coming back to Rails, then lists and calls the tools", async () => {
    const fake = await fakeOAuthMcp();
    const s = mcp.createServer({ name: "remote", transport: "http", url: fake.url });
    expect(s.signIn).toMatchObject({ state: "none", clientSecret: false });
    expect(s.signIn!.redirectUrl).toBe(`http://127.0.0.1:${process.env.RAILS_MCP_OAUTH_PORT}/mcp/oauth/callback`);

    // Turned away: it says so, and asks for a sign-in.
    const tested = await mcp.testServer(s.id);
    expect(tested.status).toMatchObject({ state: "error", error: mcp.SIGN_IN_NEEDED });
    expect(tested.signIn!.state).toBe("needed");

    const started = await mcp.startSignIn(s.id);
    expect(started.signIn!.authUrl).toMatch(/\/authorize\?/);
    expect(fake.registered).toBe(1);
    const back = await approve(started.signIn!.authUrl!);
    expect(back.startsWith(started.signIn!.redirectUrl)).toBe(true);
    const page = await fetch(back);
    expect(page.status).toBe(200);
    await until(() => view(s.id).signIn!.state === "signed-in" && view(s.id).status.state === "ok");
    expect(view(s.id).signIn!.authUrl).toBeUndefined();
    expect(view(s.id).tools.map((t) => t.name)).toEqual(["whoami"]);
    expect((await mcp.callTool(s.id, "whoami", {})).text).toBe("Signed in to the fake service.");

    // Tokens stay on the server.
    const secrets = readFileSync(join(RAILS_HOME, "mcp-secrets.json"), "utf8");
    expect(secrets).toMatch(/"access_token": "at-/);
    expect(JSON.stringify(mcp.listServers())).not.toMatch(/at-|rt-|code-/);

    // An expired token is renewed with the refresh token, without asking the user.
    fake.expireTokens();
    expect((await mcp.callTool(s.id, "whoami", {})).text).toBe("Signed in to the fake service.");
    await mcp.testServer(s.id);
    expect(view(s.id).status.state).toBe("ok");

    // Signing out forgets the tokens: the next connection is turned away again.
    expect((await mcp.signOut(s.id)).signIn!.state).toBe("none");
    expect(readFileSync(join(RAILS_HOME, "mcp-secrets.json"), "utf8")).not.toMatch(/at-/);
    expect((await mcp.testServer(s.id)).signIn!.state).toBe("needed");
    await fake.close();
  });

  it("takes the address pasted from another device, and only this sign-in's", async () => {
    const fake = await fakeOAuthMcp();
    const s = mcp.createServer({ name: "pasted", transport: "http", url: fake.url });
    const started = await mcp.startSignIn(s.id);
    const back = new URL(await approve(started.signIn!.authUrl!));

    const wrong = new URL(back);
    wrong.searchParams.set("state", "someone-else");
    await expect(mcp.pasteSignIn(s.id, wrong.href)).rejects.toThrow("another sign-in");
    await expect(mcp.pasteSignIn(s.id, "not an address")).rejects.toThrow("whole address");
    expect(view(s.id).signIn!.authUrl).toBeDefined(); // still waiting

    await mcp.pasteSignIn(s.id, back.href);
    await until(() => view(s.id).signIn!.state === "signed-in" && view(s.id).tools.length === 1);
    await fake.close();
  });

  it("says when a service needs your own app, and signs in with it", async () => {
    const fake = await fakeOAuthMcp({ registration: false, clientId: "my-app", clientSecret: "shh" });
    const s = mcp.createServer({ name: "own-app", transport: "http", url: fake.url });
    const failed = await mcp.startSignIn(s.id);
    expect(failed.signIn!.error).toMatch(/doesn't let apps register themselves/);
    expect(failed.signIn!.authUrl).toBeUndefined();

    expect(() => mcp.updateServer(s.id, { clientSecret: "shh" })).toThrow("client ID first");
    const withApp = mcp.updateServer(s.id, { clientId: "my-app", clientSecret: "shh" });
    expect(withApp.signIn).toMatchObject({ clientId: "my-app", clientSecret: true });
    expect(JSON.stringify(withApp)).not.toContain("shh");

    const started = await mcp.startSignIn(s.id);
    expect(started.signIn!.error).toBeUndefined();
    expect(new URL(started.signIn!.authUrl!).searchParams.get("client_id")).toBe("my-app");
    await fetch(await approve(started.signIn!.authUrl!));
    await until(() => view(s.id).signIn!.state === "signed-in");

    // Another app (or URL) ends the sign-in: the tokens were for the old one.
    expect(mcp.updateServer(s.id, { clientId: "other-app" }).signIn!.state).not.toBe("signed-in");
    await fake.close();
  });

  it("asks for a sign-in when only the calls are turned away", async () => {
    const fake = await fakeOAuthMcp({ openList: true });
    const s = mcp.createServer({ name: "open-list", transport: "http", url: fake.url });
    expect((await mcp.testServer(s.id)).status.state).toBe("ok");
    await expect(mcp.callTool(s.id, "whoami", {})).rejects.toThrow("open-list needs the user to sign in to it (in Customize)");
    expect(view(s.id).signIn!.state).toBe("needed");
    const started = await mcp.startSignIn(s.id);
    await fetch(await approve(started.signIn!.authUrl!));
    await until(() => view(s.id).signIn!.state === "signed-in" && view(s.id).status.state === "ok");
    expect((await mcp.callTool(s.id, "whoami", {})).text).toBe("Signed in to the fake service.");
    await fake.close();
  });

  it("frees the port when a sign-in is cancelled or another starts", async () => {
    const fake = await fakeOAuthMcp();
    const a = mcp.createServer({ name: "first", transport: "http", url: fake.url });
    const b = mcp.createServer({ name: "second", transport: "http", url: fake.url });
    const first = await mcp.startSignIn(a.id);
    // Starting another cancels the first (they share the port), without calling it a failure.
    const second = await mcp.startSignIn(b.id);
    expect(second.signIn!.authUrl).toBeDefined();
    expect(view(a.id).signIn).toMatchObject({ state: "none" });
    expect(view(a.id).signIn!.authUrl).toBeUndefined();
    expect(view(a.id).signIn!.error).toBeUndefined();
    await expect(mcp.pasteSignIn(a.id, await approve(first.signIn!.authUrl!))).rejects.toThrow("No sign-in is waiting");
    await mcp.cancelSignIn(b.id);
    expect(view(b.id).signIn!.authUrl).toBeUndefined();
    // The port is free again.
    const again = await mcp.startSignIn(b.id);
    expect(again.signIn!.error).toBeUndefined();
    await mcp.cancelSignIn(b.id);
    await fake.close();
  });
});
