// Runs before each test file (each in its own module graph): a fresh rails home, so files that run in
// parallel never share a database.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RAILS_HOME = mkdtempSync(join(tmpdir(), "rails-test-home-"));
