// The Rails pi extension answering dialogs (ADR 0027), run against a stand-in for pi: its event handlers, its
// shared ui (select/input that close on their abort signal, as pi's do), its event bus, and Rails' bridge (fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import railsBridge from "./pi/rails.ts";

type Handler = (e: any, ctx: any) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, ((d: unknown) => void)[]>();
  const pi = {
    on: (name: string, h: Handler) => void handlers.set(name, [...(handlers.get(name) ?? []), h]),
    events: {
      on: (ch: string, h: (d: unknown) => void) => {
        bus.set(ch, [...(bus.get(ch) ?? []), h]);
        return () => bus.set(ch, (bus.get(ch) ?? []).filter((x) => x !== h));
      },
      emit: (ch: string, d: unknown) => (bus.get(ch) ?? []).forEach((h) => h(d)),
    },
    registerMcpServer: () => {},
    sendUserMessage: vi.fn(),
  };
  const fire = (name: string, e: any = {}, c: any = ctx) => (handlers.get(name) ?? []).forEach((h) => h(e, c));
  // pi's dialogs: they stay open until answered in the "panel" or closed through their signal.
  const shown: { title: string; answer: (v: string | undefined) => void }[] = [];
  const dialog = (title: string, _arg: unknown, opts?: { signal?: AbortSignal }) =>
    new Promise<string | undefined>((resolve) => {
      shown.push({ title, answer: resolve });
      opts?.signal?.addEventListener("abort", () => resolve(undefined));
    });
  const ui: any = { select: dialog, input: dialog, confirm: async () => false };
  const ctx = { ui, isIdle: () => false, sessionManager: { getSessionId: () => "s1", getCwd: () => "/work" } };
  return { pi, fire, ctx, shown };
}

/** Rails' bridge: what the extension posted, and an inbox the test fills. */
function fakeRails() {
  const posts: { event: string; body: any }[] = [];
  const inbox: any[][] = [];
  let wake: (() => void) | undefined;
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
    const event = url.split("/pi/")[1];
    if (event === "inbox") {
      while (!inbox.length) await new Promise<void>((r) => (wake = r));
      return { ok: true, json: async () => ({ messages: inbox.shift() }) };
    }
    posts.push({ event, body: JSON.parse(init?.body ?? "{}") });
    return { ok: true, json: async () => ({}) };
  });
  return {
    posts,
    send(m: any) {
      inbox.push([m]);
      wake?.();
    },
    /** The extension's answer for message `id`. */
    async delivered(id: string) {
      await vi.waitFor(() => expect(posts.some((p) => p.event === "delivered" && p.body.id === id)).toBe(true), { timeout: 5000 });
      return posts.find((p) => p.event === "delivered" && p.body.id === id)!.body;
    },
  };
}

beforeEach(() => {
  process.env.RAILS_BRIDGE = "http://rails/bridge/p1";
  process.env.RAILS_PANEL_TOKEN = "tok";
});
afterEach(() => vi.unstubAllGlobals());

describe("the pi extension answers dialogs (ADR 0027)", () => {
  it("answers pi's own select from any extension, and refuses what doesn't fit it", async () => {
    const rails = fakeRails();
    const { pi, fire, ctx, shown } = fakePi();
    railsBridge(pi);
    fire("session_start");
    // Some extension asks through pi's select; pi reports the dialog.
    const picked = ctx.ui.select("Show the key on each shop card?", ["Yes", "No"]);
    fire("ui_prompt_start", { kind: "select", title: "Show the key on each shop card?" });
    await vi.waitFor(() => expect(rails.posts.find((p) => p.event === "ui_prompt_start")?.body.dialog).toEqual({ id: "select-1", kind: "select", options: ["Yes", "No"] }));
    rails.send({ id: "m1", text: "", answer: { dialog: "select-1", option: 5 } });
    expect(await rails.delivered("m1")).toMatchObject({ ok: false, error: "That answer doesn't fit the dialog." });
    rails.send({ id: "m2", text: "", answer: { dialog: "select-1", option: 1 } });
    expect(await picked).toBe("No");
    expect(await rails.delivered("m2")).toMatchObject({ ok: true });
    expect(shown).toHaveLength(1);
    // Answered already: a late answer finds no dialog.
    rails.send({ id: "m3", text: "", answer: { dialog: "select-1", option: 0 } });
    expect(await rails.delivered("m3")).toMatchObject({ ok: false, error: "The dialog has closed." });
  });

  it("leaves the panel's answer alone (first answer wins)", async () => {
    const rails = fakeRails();
    const { pi, fire, ctx, shown } = fakePi();
    railsBridge(pi);
    fire("session_start");
    const typed = ctx.ui.input("Branch name?", "main");
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    shown[0].answer("feature/keys"); // the user typed it in the panel
    expect(await typed).toBe("feature/keys");
    rails.send({ id: "m1", text: "", answer: { dialog: "input-1", text: "main" } });
    expect(await rails.delivered("m1")).toMatchObject({ ok: false, error: "The dialog has closed." });
  });

  it("answers rpiv-ask-user-question through its answer event", async () => {
    const rails = fakeRails();
    const { pi, fire } = fakePi();
    railsBridge(pi);
    fire("session_start");
    const asked: any[] = [];
    pi.events.on("rpiv:ask-user:answer", (d: any) => {
      asked.push(d);
      pi.events.emit("rpiv:ask-user:answer-result", { ok: true, requestId: d.requestId, toolCallId: d.toolCallId });
    });
    pi.events.emit("rpiv:ask-user:prompt", { toolCallId: "t1", questions: [{ question: "Colour?", options: [{ label: "Blue" }, { label: "Green" }] }] });
    fire("ui_prompt_start", { kind: "custom" });
    await vi.waitFor(() => expect(rails.posts.find((p) => p.event === "ui_prompt_start")?.body.dialog).toEqual({ id: "rpiv-t1", kind: "questionnaire" }));
    rails.send({ id: "m1", text: "", answer: { dialog: "rpiv-t1", text: "Teal" } });
    expect(await rails.delivered("m1")).toMatchObject({ ok: true });
    expect(asked[0]).toMatchObject({ toolCallId: "t1", answers: [{ questionIndex: 0, text: "Teal" }] });
  });

  it("says so when the question extension doesn't take answers (before 2.13.9)", async () => {
    const rails = fakeRails();
    const { pi, fire } = fakePi();
    railsBridge(pi);
    fire("session_start");
    pi.events.emit("rpiv:ask-user:prompt", { toolCallId: "t2", questions: [{ question: "Colour?", options: [] }] });
    rails.send({ id: "m1", text: "", answer: { dialog: "rpiv-t2", option: 0 } });
    expect(await rails.delivered("m1")).toMatchObject({ ok: false, error: "The question extension didn't take the answer: answer it in the panel." });
  });
});
