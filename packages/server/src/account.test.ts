import { describe, expect, it } from "vitest";
import { serverInfo, signOutEverywhere } from "./account.ts";

describe("account", () => {
  // vitest.config.ts sets RAILS_TOKEN, like a user who pins the token in the environment.
  it("won't replace a token that's set with RAILS_TOKEN", () => {
    expect(() => signOutEverywhere()).toThrow("RAILS_TOKEN");
  });

  it("describes the server", async () => {
    const info = await serverInfo();
    expect(info).toMatchObject({ host: "127.0.0.1", network: false, tokenFromEnv: true });
    expect(info.node).toMatch(/^v\d+/);
  });
});
