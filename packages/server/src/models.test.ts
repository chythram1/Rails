import { describe, expect, it } from "vitest";
import { checkKey, modelSettings, setApiKey } from "./models.ts";

/** A stand-in for the provider's API that answers `status` and records what it was asked. */
function provider(status: number) {
  const asked: Request[] = [];
  const fetchFn = (async (req: Request) => {
    asked.push(req);
    return new Response("{}", { status });
  }) as typeof fetch;
  return { asked, fetchFn };
}

describe("checking API keys", () => {
  it("asks the key's own provider, with the key, for something free", async () => {
    const { asked, fetchFn } = provider(200);
    expect(await checkKey("anthropic", "sk-ant-1", fetchFn)).toEqual({ verdict: "ok" });
    expect(asked[0].url).toBe("https://api.anthropic.com/v1/models");
    expect(asked[0].headers.get("x-api-key")).toBe("sk-ant-1");
    await checkKey("openai", "sk-2", provider(200).fetchFn);
  });

  it("tells a refused key from one it couldn't check", async () => {
    expect(await checkKey("openai", "bad", provider(401).fetchFn)).toEqual({ verdict: "rejected" });
    expect(await checkKey("mistral", "bad", provider(403).fetchFn)).toEqual({ verdict: "rejected" });
    expect(await checkKey("groq", "k", provider(429).fetchFn)).toMatchObject({ verdict: "unknown", reason: expect.stringContaining("rate-limiting") });
    expect(await checkKey("xai", "k", provider(500).fetchFn)).toEqual({ verdict: "unknown", reason: "it answered 500" });
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await checkKey("deepseek", "k", offline)).toEqual({ verdict: "unknown", reason: "Rails couldn't reach it" });
  });

  it("doesn't save a key the provider refused, and says when one couldn't be checked", async () => {
    await expect(setApiKey("openai", "sk-bad", async () => ({ verdict: "rejected" }))).rejects.toThrow("OpenAI rejected this key");
    expect((await modelSettings()).providers.find((p) => p.id === "openai")!.auth).toBeNull();
    expect(await setApiKey("openai", "sk-good", async () => ({ verdict: "ok" }))).toEqual({});
    expect((await modelSettings()).providers.find((p) => p.id === "openai")!.auth).toEqual({ type: "api_key" });
    expect(await setApiKey("mistral", "k", async () => ({ verdict: "unknown", reason: "it didn't answer in time" }))).toEqual({
      note: "Saved, but Rails couldn't check it: it didn't answer in time.",
    });
  });
});
