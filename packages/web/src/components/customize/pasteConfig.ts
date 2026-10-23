// Reading a pasted MCP server config, so adding a custom server is a paste instead of a form (Customize's draft).
// READMEs give one of: the `mcpServers` JSON (Claude Desktop, Cursor; VS Code calls it `servers`), a `claude mcp add`
// or `codex mcp add` line, or Codex's TOML. Values that are placeholders ("<YOUR_TOKEN>", "${API_KEY}") are left
// for the user to fill in, never sent as they are.

export interface PastedServer {
  name: string;
  transport: "stdio" | "http";
  url: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  /** Env or header names whose value is a placeholder (left empty), to fill in. */
  missing: string[];
  /** Arguments that look like placeholders ("/path/to/files"), to check. */
  checkArgs: string[];
}

type Pasted = { servers: PastedServer[] } | { error: string };

const PLACEHOLDER = /^<.*>$|^\$\{.+\}$|^\$[A-Z_][A-Z0-9_]*$|your[-_ ]?[a-z]|^x{4,}|replace[-_ ]?(me|with)|^\.\.\.$|^\*{3,}$/i;
const PLACEHOLDER_ARG = /^<.*>$|\/path\/to\b|your[-_ ]?[a-z]|^\$\{.+\}$/i;
/** Names Rails takes for servers (mcp.ts NAME): lowercase letters, digits, - and _. */
const serverName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 40) || "server";

function server(name: string, raw: { url?: string; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; type?: string }): PastedServer | string {
  const type = raw.type?.toLowerCase();
  if (type === "sse") return `${name} uses SSE, an older transport Rails doesn't speak: look for its Streamable HTTP address (often ending in /mcp).`;
  const url = raw.url?.trim() ?? "";
  if (!url && !raw.command?.trim()) return `${name} has neither a command nor a URL.`;
  const missing: string[] = [];
  const values = (o: Record<string, string> | undefined) =>
    Object.fromEntries(
      Object.entries(o ?? {}).map(([k, v]) => {
        const value = String(v ?? "").trim();
        // "Bearer <TOKEN>": the placeholder is the part after the scheme.
        const bare = value.replace(/^(Bearer|Basic|Token)\s+/i, "");
        if (!value || PLACEHOLDER.test(bare)) {
          missing.push(k);
          return [k, ""];
        }
        return [k, value];
      }),
    );
  const env = values(raw.env);
  const headers = values(raw.headers);
  const args = (raw.args ?? []).map(String);
  return {
    name: serverName(name),
    transport: url ? "http" : "stdio",
    url,
    command: url ? "" : raw.command!.trim(),
    args: url ? [] : args,
    env: url ? {} : env,
    headers: url ? headers : {},
    missing,
    checkArgs: args.filter((a) => PLACEHOLDER_ARG.test(a)),
  };
}

/** A server entry from the JSON shapes in the wild: `url` / `serverUrl` / `httpUrl`, `command` + `args`, `env`, `headers`. */
function fromJsonEntry(name: string, e: any): PastedServer | string {
  if (!e || typeof e !== "object") return `${name} isn't a server entry.`;
  const strings = (o: any) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) : undefined);
  return server(name, {
    url: e.url ?? e.serverUrl ?? e.httpUrl,
    command: typeof e.command === "string" ? e.command : undefined,
    args: Array.isArray(e.args) ? e.args : undefined,
    env: strings(e.env),
    headers: strings(e.headers),
    type: e.type ?? e.transport,
  });
}

const isEntry = (v: any) => v && typeof v === "object" && ("command" in v || "url" in v || "serverUrl" in v || "httpUrl" in v);

function fromJson(text: string): Pasted | undefined {
  let data: any;
  // READMEs often show the inside of an object (`"mcpServers": {…}` or `"name": {…}`), sometimes with trailing commas.
  const loose = text.trim().replace(/,(\s*[}\]])/g, "$1");
  for (const candidate of [loose, `{${loose.replace(/,\s*$/, "")}}`]) {
    try {
      data = JSON.parse(candidate);
      break;
    } catch {}
  }
  if (data === undefined || typeof data !== "object" || data === null) return undefined;
  const map = data.mcpServers ?? data.servers ?? data.mcp?.servers ?? data["mcp_servers"] ?? (isEntry(data) ? { server: data } : data);
  const entries = Object.entries(map).filter(([, v]) => v && typeof v === "object");
  if (!entries.length) return { error: "That JSON has no servers in it." };
  return collect(entries.map(([name, e]) => fromJsonEntry(name, e)));
}

/** Split a command line like a shell would for these lines: quotes, backslash escapes and line continuations. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let cur = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  const s = line.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < s.length) {
      cur += s[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) words.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) words.push(cur);
  return words;
}

const keyValue = (s: string, sep: "=" | ":") => {
  const i = s.indexOf(sep);
  return i > 0 ? ([s.slice(0, i).trim(), s.slice(i + 1).trim()] as const) : undefined;
};

/** `claude mcp add [-t http|sse|stdio] [-e K=V] [-H "K: V"] [-s scope] <name> <url | -- command args…>`, or `claude mcp add-json <name> '<json>'`. */
function fromClaude(words: string[]): Pasted {
  if (words[2] === "add-json") {
    const name = words[3];
    const json = words.slice(4).join(" ");
    try {
      return collect([fromJsonEntry(name ?? "server", JSON.parse(json))]);
    } catch {
      return { error: "The JSON in that add-json line doesn't parse." };
    }
  }
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let type: string | undefined;
  const rest: string[] = [];
  let i = 3;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "--") {
      i++;
      break;
    }
    const [flag, inline] = w.startsWith("--") && w.includes("=") ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w, undefined];
    const value = () => inline ?? words[++i] ?? "";
    if (flag === "-t" || flag === "--transport") type = value();
    else if (flag === "-e" || flag === "--env") {
      const kv = keyValue(value(), "=");
      if (kv) env[kv[0]] = kv[1];
    } else if (flag === "-H" || flag === "--header") {
      const kv = keyValue(value(), ":");
      if (kv) headers[kv[0]] = kv[1];
    } else if (flag === "-s" || flag === "--scope" || flag === "--callback-port" || flag === "--client-id") value();
    else if (flag === "--client-secret") {
      /* a flag without a value in the line: it asks for the secret */
    } else if (w.startsWith("-") && !rest.length) {
      /* another option this reader doesn't know: skip it */
    } else rest.push(w);
  }
  const [name, target, ...more] = [...rest, ...words.slice(i)];
  if (!name || !target) return { error: "That claude mcp add line has no name and command or URL." };
  const isUrl = /^https?:\/\//i.test(target) && type !== "stdio";
  return collect([
    server(name, isUrl ? { url: target, headers, type } : { command: target, args: more, env, type: type === "stdio" ? undefined : type }),
  ]);
}

/** `codex mcp add <name> [--env K=V]… -- <command> [args…]`, or `codex mcp add <name> --url <url> [--bearer-token-env-var VAR]`. */
function fromCodex(words: string[]): Pasted {
  const env: Record<string, string> = {};
  let url: string | undefined;
  let bearer = false;
  let name: string | undefined;
  let i = 3;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "--") {
      i++;
      break;
    }
    const [flag, inline] = w.startsWith("--") && w.includes("=") ? [w.slice(0, w.indexOf("=")), w.slice(w.indexOf("=") + 1)] : [w, undefined];
    const value = () => inline ?? words[++i] ?? "";
    if (flag === "--env") {
      const kv = keyValue(value(), "=");
      if (kv) env[kv[0]] = kv[1];
    } else if (flag === "--url") url = value();
    else if (flag === "--bearer-token-env-var") (value(), (bearer = true)); // the token is in a variable Rails can't read
    else if (!w.startsWith("-") && !name) name = w;
  }
  if (!name) return { error: "That codex mcp add line has no name." };
  if (url) return collect([server(name, { url, headers: bearer ? { Authorization: "" } : {} })]);
  const [command, ...args] = words.slice(i);
  if (!command) return { error: "That codex mcp add line has no command after --." };
  return collect([server(name, { command, args, env })]);
}

/** Codex's config.toml: `[mcp_servers.<name>]` tables with `command`, `args`, `url`, and `[mcp_servers.<name>.env]`. */
function fromToml(text: string): Pasted | undefined {
  if (!/^\s*\[mcp_servers\./m.test(text)) return undefined;
  const servers = new Map<string, { command?: string; args?: string[]; url?: string; env: Record<string, string>; headers: Record<string, string> }>();
  let at: { name: string; part?: "env" | "headers" } | undefined;
  const str = (v: string) => {
    const m = v.trim().match(/^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/);
    return m ? (m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]) : undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+|\s+$/g, "");
    if (!line || line.startsWith("#")) continue;
    const table = line.match(/^\[mcp_servers\.("?)([^".\]]+)\1(?:\.(env|http_headers|headers))?\]$/);
    if (table) {
      const name = table[2];
      if (!servers.has(name)) servers.set(name, { env: {}, headers: {} });
      at = { name, part: table[3] === "env" ? "env" : table[3] ? "headers" : undefined };
      continue;
    }
    if (line.startsWith("[")) {
      at = undefined;
      continue;
    }
    const kv = at && keyValue(line, "=");
    if (!at || !kv) continue;
    const s = servers.get(at.name)!;
    const [k, v] = kv;
    if (at.part) {
      const value = str(v);
      if (value !== undefined) s[at.part][k.replace(/^"|"$/g, "")] = value;
    } else if (k === "command" || k === "url") s[k] = str(v);
    else if (k === "args") s.args = [...v.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]));
  }
  if (!servers.size) return { error: "That TOML has no servers in it." };
  return collect([...servers].map(([name, s]) => server(name, s)));
}

function collect(results: (PastedServer | string)[]): Pasted {
  const servers = results.filter((r): r is PastedServer => typeof r !== "string");
  const problems = results.filter((r): r is string => typeof r === "string");
  if (!servers.length) return { error: problems[0] ?? "No servers found in it." };
  return { servers };
}

/** Read a pasted config: JSON, a `claude mcp add` / `codex mcp add` line, or Codex's TOML. */
export function readPastedConfig(text: string): Pasted {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Paste a config first." };
  const words = shellWords(trimmed.replace(/^\$\s+/, ""));
  if (words[0] === "claude" && words[1] === "mcp" && (words[2] === "add" || words[2] === "add-json")) return fromClaude(words);
  if (words[0] === "codex" && words[1] === "mcp" && words[2] === "add") return fromCodex(words);
  return (
    fromToml(trimmed) ??
    fromJson(trimmed) ?? {
      error: "Rails can't read that. Paste the JSON from the server's README (with mcpServers), a claude mcp add or codex mcp add line, or Codex's TOML.",
    }
  );
}
