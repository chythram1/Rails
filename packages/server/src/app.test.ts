import { describe, expect, it } from "vitest";
import { app, upgradeAuthorized } from "./app.ts";
import { bridgeEnv } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";

// The access token is "test" (vitest.config.ts). Requests reach the app without a network, so each says where it
// comes from, as Node's server would.
const LOOPBACK = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
const LAN = { incoming: { socket: { remoteAddress: "192.168.1.20" } } };
const HOST = "rails.test:4317";
const SIGNED_IN = "rails_token=test";

const call = (path: string, init: RequestInit & { from?: object } = {}) => {
  const headers = new Headers(init.headers);
  headers.set("host", HOST);
  return app.request(`http://${HOST}${path}`, { ...init, headers }, init.from ?? LAN);
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}, from?: object) =>
  call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers }, from });

describe("signing in", () => {
  it("sets the login cookie for the right token only", async () => {
    expect((await post("/api/auth/login", { token: "wrong" })).status).toBe(401);
    const ok = await post("/api/auth/login", { token: "test" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/^rails_token=test;.*HttpOnly/);
  });

  it("refuses a malformed body as a wrong token, not a server error", async () => {
    const res = await call("/api/auth/login", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });
});

describe("the API", () => {
  it("needs the login cookie", async () => {
    expect((await call("/api/projects")).status).toBe(401);
    expect((await call("/api/projects", { headers: { cookie: "rails_token=wrong" } })).status).toBe(401);
    expect((await call("/api/projects", { headers: { cookie: SIGNED_IN } })).status).toBe(200);
  });

  it("refuses changes from another origin, even with the cookie", async () => {
    const prompt = { name: "Hi", text: "hello" };
    const other = await post("/api/prompts", prompt, { cookie: SIGNED_IN, origin: "http://rails.test:5173" });
    expect(other.status).toBe(403);
    expect((await post("/api/prompts", prompt, { cookie: SIGNED_IN, origin: `http://${HOST}` })).status).toBe(201);
    expect((await post("/api/prompts", prompt, { cookie: SIGNED_IN })).status).toBe(201); // curl sends no origin
  });
});

describe("the bridge", () => {
  const panel = (sessionId: string) => {
    const projectId = projects.create("app", `/work/app-${sessionId}`).id;
    const p = panels.create({ projectId, kind: "pi", sessionId, title: "pi" });
    return { id: p.id, token: bridgeEnv(p.id).RAILS_PANEL_TOKEN };
  };
  const delivered = (panelId: string, token: string | undefined, from: object) =>
    post(`/bridge/${panelId}/pi/delivered`, {}, token ? { authorization: `Bearer ${token}` } : {}, from);

  it("takes a panel's reports over loopback with its own token only", async () => {
    const a = panel("s-a");
    const b = panel("s-b");
    expect((await delivered(a.id, a.token, LOOPBACK)).status).toBe(200);
    expect((await delivered(a.id, undefined, LOOPBACK)).status).toBe(401);
    expect((await delivered(a.id, b.token, LOOPBACK)).status).toBe(401); // another panel's token
    expect((await delivered(a.id, a.token, LAN)).status).toBe(401); // not from this machine
    expect((await delivered(a.id, "test", LOOPBACK)).status).toBe(401); // the access token isn't a panel's
  });
});

describe("the terminals' WebSocket", () => {
  it("connects with the login cookie from the rails page only", () => {
    expect(upgradeAuthorized({ host: HOST, cookie: SIGNED_IN, origin: `http://${HOST}` })).toBe(true);
    expect(upgradeAuthorized({ host: HOST, cookie: "other=1; rails_token=test" })).toBe(true);
    expect(upgradeAuthorized({ host: HOST, origin: `http://${HOST}` })).toBe(false);
    expect(upgradeAuthorized({ host: HOST, cookie: "rails_token=wrong", origin: `http://${HOST}` })).toBe(false);
    expect(upgradeAuthorized({ host: HOST, cookie: SIGNED_IN, origin: "http://evil.test" })).toBe(false);
  });
});
