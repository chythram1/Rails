import { Type } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { Capability } from "./capabilities.ts";
import { codemodeDescription, codemodeTool, MAX_ACTS_PER_RUN, type CallRecord } from "./codemode.ts";

const capabilities: Capability[] = [
  {
    name: "count",
    description: "How long a word is.",
    params: Type.Object({ of: Type.String() }),
    output: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
    effect: "read",
    run: async ({ of }) => ({ n: of.length }),
  },
  { name: "say", description: "Text back.", params: Type.Object({ text: Type.String() }), effect: "read", run: async ({ text }) => `said ${text}` },
  { name: "poke", description: "Changes something.", params: Type.Object({}), effect: "act", run: async () => "poked" },
];

function setup() {
  let store: Record<string, unknown> = {};
  const tool = codemodeTool(capabilities, { sprocketId: "s" }, {
    store: () => store,
    saveStore: ({ set, delete: gone }) => {
      store = { ...store, ...set };
      for (const k of gone) delete store[k];
    },
  });
  const run = async (code: string) => {
    const r = await tool.execute("call", { code }, new AbortController().signal);
    return { text: (r.content[0] as { text: string }).text, failed: r.isError === true, calls: (r.details as { calls: CallRecord[] }).calls };
  };
  return { tool, run, store: () => store };
}

describe("codemode", () => {
  it("describes each capability with its TypeScript declaration, as pi does", () => {
    const d = codemodeDescription(capabilities);
    expect(d).toContain("QuickJS sandbox");
    expect(d).toContain("### `count`");
    expect(d).toMatch(/of: string/);
    expect(d).toMatch(/Promise<\{ n: number; \}>/);
  });

  it("runs a script: structured and text results, output laid out like pi's", async () => {
    const { run } = setup();
    const r = await run(`const [c, s] = await Promise.all([tools.count({ of: "rails" }), tools.say({ text: "hi" })]);
      text("n=" + c.n); console.log("debug"); return s;`);
    expect(r.failed).toBe(false);
    expect(r.text).toMatch(/^Script completed\nWall time [\d.]+ seconds\nOutput:\n/);
    expect(r.text).toContain("==> text 1/2 <==\nn=5");
    expect(r.text).toContain("==> text 2/2 <==\nsaid hi");
    expect(r.text).toContain("<console_output>\ndebug\n</console_output>");
    expect(r.calls.map((c) => `${c.name}:${c.status}`)).toEqual(["count:ok", "say:ok"]);
  });

  it("checks arguments against the schema, and a failure lists the calls already made", async () => {
    const { run } = setup();
    const r = await run(`await tools.say({ text: "first" }); await tools.count({});`);
    expect(r.failed).toBe(true);
    expect(r.text).toMatch(/^Script failed/);
    expect(r.text).toContain("Script error:");
    expect(r.text).toContain("Tool calls made before the failure (they are not undone): say (ok), count (error)");
  });

  it(`stops a run after ${MAX_ACTS_PER_RUN} changes, counting across its scripts`, async () => {
    const { run } = setup();
    expect((await run(`for (let i = 0; i < ${MAX_ACTS_PER_RUN - 1}; i++) await tools.poke({});`)).failed).toBe(false);
    const r = await run(`await tools.poke({}); await tools.poke({});`);
    expect(r.failed).toBe(true);
    expect(r.text).toContain(`already made ${MAX_ACTS_PER_RUN} changes`);
  });

  it("keeps store() values across scripts, and only from scripts that succeed", async () => {
    const { run, store } = setup();
    await run(`store("seen", ["a"]);`);
    await run(`store("seen", ["b"]); throw new Error("nope");`);
    expect(store()).toEqual({ seen: ["a"] });
    expect((await run(`return load("seen")`)).text).toContain('["a"]');
  });

  it("times out a script and trims output over its budget", async () => {
    const { run } = setup();
    const slow = await run(`// @options: {"timeout_ms": 300}\nwhile (true) {}`);
    expect(slow.failed).toBe(true);
    expect(slow.text).toContain("Script timed out");
    const long = await run(`// @options: {"max_output_tokens": 50}\nreturn "x".repeat(5000)`);
    expect(long.text).toContain("Warning: truncated output");
    expect(long.text.length).toBeLessThan(800);
  });
});
