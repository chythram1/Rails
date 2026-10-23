import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { MCP_DESCRIPTION_MAX, MCP_NAME_MAX, SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type CustomizeDraft } from "../../router.ts";
import { Dropdown } from "../Dropdown.tsx";
import { Segmented } from "../Segmented.tsx";
import { EditorHead } from "./fields.tsx";
import { readPastedConfig, type PastedServer } from "./pasteConfig.ts";

/** A variable or header of a new server: its name, its value, and whether a pasted config left it to fill in. */
interface SecretRow {
  key: number;
  name: string;
  value: string;
  missing?: boolean;
}

const TITLES: Record<CustomizeDraft, string> = {
  skill: "New skill",
  prompt: "New prompt",
  http: "New server",
  stdio: "New server",
};

/**
 * Something new in Customize, before it exists: its first fields, kept here until Create. Leaving the page drops it,
 * so trying the Add menu leaves nothing behind. Once created, it opens in its editor for the rest (a server's keys,
 * its sign-in, a test).
 */
export function NewItem({ draft }: { draft: CustomizeDraft }) {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [text, setText] = useState("");
  const [args, setArgs] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">(draft === "stdio" ? "stdio" : "http");
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const nextKey = useRef(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tab = draft === "skill" ? "skills" : draft === "prompt" ? "prompts" : "connectors";
  const back = href.customize(tab);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (draft === "skill") navigate(href.skill((await api.createSkill({ name: name.trim(), description: about.replace(/\s*\n\s*/g, " ").trim(), body: text })).id));
      else if (draft === "prompt") navigate(href.prompt((await api.createPrompt({ name: name.trim(), text })).id));
      else {
        const values = Object.fromEntries(secrets.filter((r) => r.name.trim() && r.value).map((r) => [r.name.trim(), r.value]));
        const body =
          transport === "http"
            ? { transport, name: name.trim(), description: about.trim(), url: text.trim(), headers: values }
            : { transport, name: name.trim(), description: about.trim(), command: text.trim(), args: args.split("\n").map((a) => a.trim()).filter(Boolean), env: values };
        navigate(href.mcpServer((await api.createMcpServer(body)).id));
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  /** Fill the form from a server read from a pasted config. */
  const fill = (p: PastedServer) => {
    setTransport(p.transport);
    setName(p.name);
    setText(p.transport === "http" ? p.url : p.command);
    setArgs(p.args.join("\n"));
    const values = p.transport === "http" ? p.headers : p.env;
    setSecrets(Object.entries(values).map(([k, v]) => ({ key: nextKey.current++, name: k, value: v, missing: p.missing.includes(k) })));
  };
  const setSecret = (key: number, change: Partial<SecretRow>) => setSecrets((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const unfilled = secrets.filter((r) => r.missing && !r.value).map((r) => r.name);

  const row = (id: string, label: string, help: string | undefined, input: ReactNode) => (
    <div className="set-row">
      <div className="set-text">
        <label htmlFor={id}>{label}</label>
        {help && <p>{help}</p>}
      </div>
      {input}
    </div>
  );
  const line = (id: string, value: string, set: (v: string) => void, maxLength: number, placeholder?: string, first = false) => (
    <input id={id} className="input" value={value} maxLength={maxLength} placeholder={placeholder} autoFocus={first} onChange={(e) => set(e.target.value)} />
  );
  const long = (id: string, label: string, help: string, value: string, set: (v: string) => void, rows: number, maxLength?: number, placeholder?: string) => (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-help`} className="muted small">{help}</p>
      <textarea id={id} className="input" rows={rows} maxLength={maxLength} placeholder={placeholder} value={value} aria-describedby={`${id}-help`} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div className="cz-editor">
      <EditorHead back={back} backLabel={tab === "skills" ? "Skills" : tab === "prompts" ? "Prompts" : "Connectors"} title={TITLES[draft]} />
      <form className="cz-body" onSubmit={(e) => void create(e)}>
        {draft === "skill" && (
          <>
            <section className="set-group" aria-labelledby="cz-new-title">
              <h3 id="cz-new-title">Skill</h3>
              {row("cz-new-name", "Name", undefined, line("cz-new-name", name, setName, SKILL_NAME_MAX, "Release notes", true))}
            </section>
            {long("cz-new-about", "When to use it", "Sprockets see this in their instructions and read the skill when it fits. Say what it's for and when it applies.", about, setAbout, 2, SKILL_DESCRIPTION_MAX, "e.g. How we write release notes. Use it when asked for release notes or a changelog.")}
            {long("cz-new-text", "Instructions", "The skill itself (SKILL.md), in Markdown.", text, setText, 14, SKILL_BODY_MAX)}
          </>
        )}
        {draft === "prompt" && (
          <>
            <section className="set-group" aria-labelledby="cz-new-title">
              <h3 id="cz-new-title">Saved prompt</h3>
              {row("cz-new-name", "Name", "Shown in Home's prompt list.", line("cz-new-name", name, setName, SAVED_PROMPT_NAME_MAX, "Review changes", true))}
            </section>
            {long("cz-new-text", "Prompt", "The first message an agent gets. You can still edit it in the composer before sending.", text, setText, 10, SAVED_PROMPT_TEXT_MAX, "e.g. “Review the uncommitted changes and list anything risky.”")}
          </>
        )}
        {(draft === "http" || draft === "stdio") && (
          <>
            <PasteConfig onFill={fill} />
            <section className="set-group" aria-labelledby="cz-new-title">
              <h3 id="cz-new-title">Server</h3>
              {row("cz-new-name", "Name", "Lowercase letters, digits, - and _. Its tools are called name_tool.", line("cz-new-name", name, setName, MCP_NAME_MAX, transport === "http" ? "tracker" : "notes"))}
              {row("cz-new-about", "What it's for", "Sprockets see this beside its tools.", line("cz-new-about", about, setAbout, MCP_DESCRIPTION_MAX, "e.g. Our issue tracker"))}
              <div className="set-row">
                <div className="set-text">
                  <span className="set-label" id="cz-new-transport">
                    Runs as
                  </span>
                  <p>{transport === "stdio" ? "A program on this computer, started by Rails." : "A service Rails reaches over HTTP."}</p>
                </div>
                <Segmented
                  name="cz-new-transport"
                  aria-labelledby="cz-new-transport"
                  value={transport}
                  options={[
                    { value: "stdio", label: "Command" },
                    { value: "http", label: "URL" },
                  ]}
                  onChange={(v) => setTransport(v as "http" | "stdio")}
                />
              </div>
              {transport === "http"
                ? row("cz-new-text", "URL", "Its Streamable HTTP endpoint.", line("cz-new-text", text, setText, 1000, "https://example.com/mcp"))
                : row("cz-new-text", "Command", "The program, as you'd type it (npx, uvx, a path).", line("cz-new-text", text, setText, 500, "npx"))}
            </section>
            {transport === "stdio" && long("cz-new-args", "Arguments", "One per line.", args, setArgs, 3, undefined, "-y\n@modelcontextprotocol/server-filesystem\n/Users/you/notes")}
            <section className="set-group" aria-labelledby="cz-new-secrets">
              <h3 id="cz-new-secrets">{transport === "stdio" ? "Environment" : "Headers"}</h3>
              <p className="set-intro">
                {transport === "stdio" ? "Variables it starts with, such as API keys." : "Sent with every request, such as Authorization."} Values stay on the
                server once it's created.
              </p>
              {secrets.map((r) => (
                <div key={r.key} className="set-row cz-secret-add">
                  <input className="input cz-mono" aria-label={transport === "stdio" ? "Variable name" : "Header name"} placeholder={transport === "stdio" ? "API_KEY" : "Authorization"} value={r.name} onChange={(e) => setSecret(r.key, { name: e.target.value })} />
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    aria-label={`${r.name || "Its"} value`}
                    aria-invalid={r.missing && !r.value ? true : undefined}
                    placeholder={r.missing ? "Needs a value" : "Value"}
                    value={r.value}
                    onChange={(e) => setSecret(r.key, { value: e.target.value })}
                  />
                  <button type="button" className="btn small" aria-label={`Remove ${r.name || "this row"}`} onClick={() => setSecrets((rows) => rows.filter((x) => x.key !== r.key))}>
                    Remove
                  </button>
                </div>
              ))}
              <div className="cz-secret-more">
                <button type="button" className="btn small" onClick={() => setSecrets((rows) => [...rows, { key: nextKey.current++, name: "", value: "" }])}>
                  {transport === "stdio" ? "Add a variable" : "Add a header"}
                </button>
              </div>
            </section>
            {unfilled.length > 0 && (
              <p className="muted small" role="status">
                The config left {unfilled.join(", ")} for you to fill in. It can also be added after it's created.
              </p>
            )}
            <p className="set-intro">{transport === "http" ? "Sign in and test it once it's created." : "Test it once it's created."}</p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="sp-field-foot">
          <span className="grow" />
          <a className="btn small" href={back}>
            Cancel
          </a>
          <button className="btn small primary" disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Paste a server's config from its README (the mcpServers JSON, a claude mcp add or codex mcp add line, or Codex's
 * TOML) and fill the form from it. With several servers in it, pick which.
 */
function PasteConfig({ onFill }: { onFill(s: PastedServer): void }) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<PastedServer[]>([]);
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const read = () => {
    const r = readPastedConfig(text);
    if ("error" in r) {
      setError(r.error);
      setFound([]);
      setNote("");
      return;
    }
    setError("");
    setFound(r.servers);
    setPicked(r.servers[0].name);
    onFill(r.servers[0]);
    const s = r.servers[0];
    setNote(
      [
        r.servers.length > 1 ? `It has ${r.servers.length} servers. Pick which one to add.` : `Filled in ${s.name}.`,
        s.checkArgs.length ? `Check ${s.checkArgs.length > 1 ? "these arguments" : "this argument"}: ${s.checkArgs.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  };
  return (
    <section className="set-group" aria-labelledby="cz-paste-title">
      <h3 id="cz-paste-title">Paste a config</h3>
      <div className="settings-field">
        <label htmlFor="cz-paste" className="sr-only">
          Config
        </label>
        <p id="cz-paste-help" className="muted small">
          From the server's README: its JSON (with mcpServers), a claude mcp add or codex mcp add line, or Codex's TOML. Or fill in the form yourself.
        </p>
        <textarea id="cz-paste" className="input cz-mono" rows={4} spellCheck={false} autoFocus value={text} aria-describedby="cz-paste-help" onChange={(e) => setText(e.target.value)} placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'} />
        <div className="sp-field-foot">
          {found.length > 1 && (
            <Dropdown
              label="Which server"
              value={picked}
              options={found.map((s) => ({ value: s.name, label: s.name }))}
              onChange={(v) => {
                setPicked(v);
                const s = found.find((x) => x.name === v);
                if (s) onFill(s);
              }}
            />
          )}
          <span className="grow" />
          <button type="button" className="btn small" disabled={!text.trim()} onClick={read}>
            Fill in
          </button>
        </div>
        {note && (
          <p className="muted small" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
