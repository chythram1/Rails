import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

// Tests get a throwaway home from vitest.setup.ts. Vitest started anywhere else (e.g. from a parent folder)
// skips that file, and a test would then write to the user's real ~/.rails (projects, Sprockets, even a new
// access token). Refuse instead.
if (process.env.VITEST && !process.env.RAILS_HOME) {
  throw new Error("Tests need a throwaway RAILS_HOME. Run them from the repo root (make test).");
}

export const RAILS_HOME = process.env.RAILS_HOME ?? join(home, ".rails");
export const HOST = process.env.RAILS_HOST ?? "127.0.0.1";
export const PORT = Number(process.env.RAILS_PORT ?? 4317);
/**
 * `RAILS_DECISIONS=shadow`: the decision model only judges and logs, and never wakes anyone (ADR 0012, 0013). For
 * evaluating a model on real sessions; read on each use, so tests can set it.
 */
export const decisionsInShadow = () => process.env.RAILS_DECISIONS === "shadow";

export const CLAUDE_HOME = process.env.CLAUDE_HOME ?? join(home, ".claude");
export const PI_HOME = process.env.PI_HOME ?? join(home, ".pi", "agent");
export const CODEX_HOME = process.env.CODEX_HOME ?? join(home, ".codex");
/** Agent-neutral home of the user's own skills (`~/.agents/skills`), read-only (ADR 0020). */
export const AGENTS_HOME = process.env.AGENTS_HOME ?? join(home, ".agents");

/** Rails' skill library (ADR 0020). */
export const SKILLS_DIR = join(RAILS_HOME, "skills");
/** Per-panel plugin folders that carry an agent profile's skills (ADR 0020). */
export const PANEL_PLUGINS_DIR = join(RAILS_HOME, "panel-plugins");

mkdirSync(RAILS_HOME, { recursive: true });
mkdirSync(SKILLS_DIR, { recursive: true });

interface ConfigFile {
  token: string;
}

function loadConfig(): ConfigFile {
  const file = join(RAILS_HOME, "config.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as ConfigFile;
  const cfg: ConfigFile = { token: randomBytes(24).toString("base64url") };
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

/** RAILS_TOKEN pins the access token; otherwise it lives in config.json and can be replaced. */
export const TOKEN_FROM_ENV = process.env.RAILS_TOKEN !== undefined;
let token = process.env.RAILS_TOKEN ?? loadConfig().token;

export const accessToken = () => token;

/** Replace the token in config.json with a new one, so every device has to sign in again. */
export function rotateToken(): string {
  token = randomBytes(24).toString("base64url");
  const file = join(RAILS_HOME, "config.json");
  writeFileSync(file + ".tmp", JSON.stringify({ token } satisfies ConfigFile, null, 2), { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return token;
}
