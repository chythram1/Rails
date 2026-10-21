import { describe, expect, it } from "vitest";
import { providerEntries, searchSettings, SETTINGS } from "./search.ts";

const providers = providerEntries([
  { id: "openai", name: "OpenAI", auth: null, signIn: "Continue with ChatGPT" },
  { id: "anthropic", name: "Anthropic", auth: null },
]);
const all = [...SETTINGS, ...providers];
const find = (q: string) => searchSettings(q, all).map((e) => e.rowId);

describe("settings search", () => {
  it("matches labels by the start of their words, in any case", () => {
    expect(find("sign ever")).toEqual(["sign-out-everywhere"]);
    expect(find("DEFAULT")[0]).toBe("default-model");
  });

  it("finds rows by their synonyms", () => {
    expect(find("tailscale")).toEqual(["reachable"]);
    expect(find("chatgpt")).toEqual(["provider-openai"]);
    expect(find("claude")).toEqual(["provider-anthropic"]);
    expect(find("token")).toContain("sign-out-everywhere");
    expect(find("profile picture")).toEqual(["avatar"]);
    expect(find("dark mode")).toEqual(["appearance"]);
    expect(find("jev threshold")).toEqual(["decision-threshold"]);
  });

  it("puts label matches before synonym matches", () => {
    const r = find("sign");
    expect(r.slice(0, 2).sort()).toEqual(["sign-out", "sign-out-everywhere"]);
    expect(r).toContain("provider-openai"); // it has a sign-in
    expect(r).not.toContain("provider-anthropic"); // it takes only an API key
  });

  it("puts provider rows in Providers, and model choices in Models", () => {
    expect(providers.map((e) => e.section)).toEqual(["providers", "providers"]);
    expect(SETTINGS.find((e) => e.rowId === "default-model")!.section).toBe("models");
  });

  it("finds nothing for an empty or unrelated query", () => {
    expect(find("  ")).toEqual([]);
    expect(find("zebra")).toEqual([]);
  });
});
