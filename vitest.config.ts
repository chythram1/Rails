import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Tests never touch real state: every run gets fresh, empty homes for the agents' stores, and every test
// file its own rails home (vitest.setup.ts). The server reads these env vars once, when `config.ts` loads.
const home = mkdtempSync(join(tmpdir(), "rails-test-"));

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    env: {
      RAILS_TOKEN: "test",
      CLAUDE_HOME: join(home, "claude"),
      PI_HOME: join(home, "pi"),
      CODEX_HOME: join(home, "codex"),
    },
  },
});
