import { useState, type FormEvent, type ReactNode } from "react";
import { MCP_DESCRIPTION_MAX, MCP_NAME_MAX, SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, SKILL_BODY_MAX, SKILL_DESCRIPTION_MAX, SKILL_NAME_MAX } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate, type CustomizeDraft } from "../../router.ts";
import { EditorHead } from "./fields.tsx";

const TITLES: Record<CustomizeDraft, string> = {
  skill: "New skill",
  prompt: "New prompt",
  http: "New server with a URL",
  stdio: "New server with a command",
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
        const body =
          draft === "http"
            ? { transport: draft, name: name.trim(), description: about.trim(), url: text.trim() }
            : { transport: draft, name: name.trim(), description: about.trim(), command: text.trim(), args: args.split("\n").map((a) => a.trim()).filter(Boolean) };
        navigate(href.mcpServer((await api.createMcpServer(body)).id));
      }
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

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
            <section className="set-group" aria-labelledby="cz-new-title">
              <h3 id="cz-new-title">Server</h3>
              {row("cz-new-name", "Name", "Lowercase letters, digits, - and _. Its tools are called name_tool.", line("cz-new-name", name, setName, MCP_NAME_MAX, draft === "http" ? "tracker" : "notes", true))}
              {row("cz-new-about", "What it's for", "Sprockets see this beside its tools.", line("cz-new-about", about, setAbout, MCP_DESCRIPTION_MAX, "e.g. Our issue tracker"))}
              {draft === "http"
                ? row("cz-new-text", "URL", "Its Streamable HTTP endpoint.", line("cz-new-text", text, setText, 1000, "https://example.com/mcp"))
                : row("cz-new-text", "Command", "The program, as you'd type it (npx, uvx, a path).", line("cz-new-text", text, setText, 500, "npx"))}
            </section>
            {draft === "stdio" && long("cz-new-args", "Arguments", "One per line.", args, setArgs, 3, undefined, "-y\n@modelcontextprotocol/server-filesystem\n/Users/you/notes")}
            <p className="set-intro">{draft === "http" ? "Add headers, sign in and test it once it's created." : "Add its keys and test it once it's created."}</p>
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
