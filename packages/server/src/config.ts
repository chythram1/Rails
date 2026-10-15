import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const RAILS_HOME = process.env.RAILS_HOME ?? join(home, ".rails");
export const HOST = process.env.RAILS_HOST ?? "127.0.0.1";
export const PORT = Number(process.env.RAILS_PORT ?? 4317);

export const CLAUDE_HOME = process.env.CLAUDE_HOME ?? join(home, ".claude");
export const PI_HOME = process.env.PI_HOME ?? join(home, ".pi", "agent");
export const CODEX_HOME = process.env.CODEX_HOME ?? join(home, ".codex");

mkdirSync(RAILS_HOME, { recursive: true });

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

export const TOKEN = process.env.RAILS_TOKEN ?? loadConfig().token;
