import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("RAILS_HOME", () => {
  it("is closed to everyone but its user, also when it was made open before", async () => {
    const before = process.env.RAILS_HOME;
    const home = mkdtempSync(join(tmpdir(), "rails-test-open-"));
    chmodSync(home, 0o755);
    process.env.RAILS_HOME = home;
    try {
      vi.resetModules();
      const { RAILS_HOME } = await import("./config.ts");
      expect(RAILS_HOME).toBe(home);
      expect(statSync(home).mode & 0o777).toBe(0o700);
    } finally {
      process.env.RAILS_HOME = before;
    }
  });
});
