// Rails' Claude Code mod (ADR 0028), run against a stand-in for Claude Code's mods API: `$.env`, `$.http.fetch`
// (Rails' bridge, which the test answers), `$.clock.sleep`, and `next(e)`, which is Claude's own question dialog.
import { describe, expect, it, vi } from "vitest";
import { register } from "./claude/mod/hooks/register.js";
import { supportsMods } from "./wiring.ts";
import { fromClaude } from "./events.ts";

type Hook = ($: any, e: any, next: any) => Promise<any>;

function load() {
  let hook: Hook | undefined;
  register((event: string, match: any, fn: Hook) => {
    expect(event).toBe("tool.call");
    expect(match).toEqual({ tool: "AskUserQuestion" });
    hook = fn;
  });
  const posts: { path: string; body: any }[] = [];
  const inbox: any[][] = [];
  let wake: (() => void) | undefined;
  const $ = {
    env: { get: async (name: string) => ({ RAILS_BRIDGE: "http://rails/bridge/p1", RAILS_PANEL_TOKEN: "tok" })[name] },
    clock: { sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) },
    http: {
      fetch: async (url: string, init?: { method?: string; body?: string }) => {
        const path = url.split("/claude/")[1];
        if (path === "inbox") {
          while (!inbox.length) await new Promise<void>((r) => (wake = r));
          return { ok: true, status: 200, text: JSON.stringify({ messages: inbox.shift() }) };
        }
        posts.push({ path, body: JSON.parse(init?.body ?? "{}") });
        return { ok: true, status: 200, text: "{}" };
      },
    },
  };
  // Claude's dialog: answered in the panel when the test says so.
  let answerInPanel: ((v: any) => void) | undefined;
  const next = vi.fn(() => new Promise((r) => (answerInPanel = r)));
  const e = { tool_use_id: "toolu_1", tool: "AskUserQuestion", questions: [{ question: "Dark or light?", header: "Theme", options: [{ label: "Dark" }, { label: "Light" }], multiSelect: false }] };
  return {
    run: (event: object = e) => hook!($, event, next),
    posts,
    next,
    send(m: any) {
      inbox.push([m]);
      wake?.();
    },
    panel: (v: any) => answerInPanel!(v),
  };
}

describe("Rails' Claude Code mod (ADR 0028)", () => {
  it("tells Rails the dialog is open, and closes it with Rails' answer", async () => {
    const m = load();
    const done = m.run();
    await vi.waitFor(() => expect(m.posts[0]).toEqual({ path: "dialog", body: { id: "toolu_1", question: "Dark or light?", options: ["Dark", "Light"] } }));
    m.send({ id: "a1", text: "", answer: { dialog: "toolu_2", text: "Dark" } }); // another dialog's: refused
    m.send({ id: "a2", text: "", answer: { dialog: "toolu_1", text: "Light" } });
    expect(await done).toEqual({ result: { questions: expect.any(Array), answers: { "Dark or light?": "Light" } } });
    expect(m.posts.filter((p) => p.path === "delivered").map((p) => p.body)).toEqual([
      { id: "a1", ok: false, error: "The dialog has closed." },
      { id: "a2", ok: true },
    ]);
  });

  it("lets the panel's answer stand, and refuses Rails' after it", async () => {
    const m = load();
    const done = m.run();
    await vi.waitFor(() => expect(m.next).toHaveBeenCalled());
    const fromPanel = { result: { answers: { "Dark or light?": "Dark" } } };
    m.panel(fromPanel);
    expect(await done).toBe(fromPanel);
    m.send({ id: "late", text: "", answer: { dialog: "toolu_1", text: "Light" } });
    await vi.waitFor(() => expect(m.posts.find((p) => p.path === "delivered")?.body).toEqual({ id: "late", ok: false, error: "The dialog has closed." }));
  });

  it("leaves several questions to the panel", async () => {
    const m = load();
    const two = { tool_use_id: "toolu_3", questions: [{ question: "A?", options: [] }, { question: "B?", options: [] }] };
    void m.run(two);
    await vi.waitFor(() => expect(m.next).toHaveBeenCalledWith(two));
    expect(m.posts).toEqual([]);
  });

  it("is loaded only by a Claude Code that takes mods", () => {
    expect(supportsMods("2.1.309 (Claude Code)")).toBe(true);
    expect(supportsMods("2.1.287 (Claude Code)")).toBe(true);
    expect(supportsMods("2.1.286 (Claude Code)")).toBe(false);
    expect(supportsMods("1.9.999")).toBe(false);
    expect(supportsMods("3.0.0")).toBe(true);
    expect(supportsMods("")).toBe(false);
  });

  it("reads the mod's report as a question Rails can answer", () => {
    expect(fromClaude("dialog", { id: "toolu_1", question: "Dark or light?", options: ["Dark", "Light"] })).toEqual([
      { kind: "waiting", reason: "question", questions: [{ question: "Dark or light?", options: ["Dark", "Light"] }], dialog: { id: "toolu_1", kind: "claude", options: ["Dark", "Light"] } },
    ]);
    expect(fromClaude("dialog", { question: "No id?" })).toEqual([]);
  });
});
