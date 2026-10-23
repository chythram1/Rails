import { useState, type FormEvent } from "react";
import { IconExternalLink as ExternalLink } from "@tabler/icons-react";
import type { Connector, McpServer } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { EditorHead } from "./fields.tsx";

/**
 * A connector not added yet (shared CONNECTORS): its mark and what it does, then how it connects with the one step
 * that does it (Connect, a token, a folder from the picker, or adding it to set up its app). Adding it makes an MCP
 * server; its editor takes over from there (and runs the sign-in).
 */
export function ConnectorPage({ connector: c, added }: { connector: Connector; added: McpServer[] }) {
  const { profile } = useStore();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async (e?: FormEvent) => {
    e?.preventDefault();
    setError("");
    setBusy(true);
    try {
      const made = await api.addConnector(c.id, c.setup === "token" ? { token } : {});
      navigate(href.mcpServer(made.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const computer = profile?.name ?? "the computer Rails runs on";
  const how: Record<Connector["setup"], string> = {
    "sign-in": `Sign in with your ${c.by} account. Rails keeps the token on this computer and renews it.`,
    none: "No account needed: it works as soon as it's added.",
    token: c.token?.help ?? "",
    "own-app": "Register an app with the service, then enter its client ID and secret on the next page. It shows the redirect address to give the app.",
    folder: `Pick the folder it may use. The picker opens on ${computer}'s screen.`,
  };
  const action: Record<Connector["setup"], string> = {
    "sign-in": "Connect",
    none: "Connect",
    token: "Connect",
    "own-app": "Add it",
    folder: "Choose a folder…",
  };
  const where = c.url ?? [c.command, ...(c.args ?? []), c.setup === "folder" ? "<folder>" : ""].filter(Boolean).join(" ");

  return (
    <div className="cz-editor">
      <EditorHead back={href.customize("connectors")} backLabel="Connectors" />
      <div className="cz-body">
        <header className="cz-hero">
          <ConnectorLogo id={c.id} size={64} />
          <div className="cz-hero-text">
            <h1 className="cz-hero-name">{c.name}</h1>
            <p className="cz-hero-by">by {c.by}</p>
          </div>
        </header>
        <p className="cz-about">
          <span className="cz-about-lead">{c.description}</span> {c.about}
        </p>
        {added.length > 0 && (
          <p className="cz-already" role="status">
            Already added:{" "}
            {added.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                <a href={href.mcpServer(s.id)}>{s.name}</a>
              </span>
            ))}
            . Adding it again makes another.
          </p>
        )}
        <section className="set-group" aria-labelledby="cz-how">
          <h3 id="cz-how">How it connects</h3>
          <form className="cz-connect" onSubmit={(e) => void add(e)}>
            <p className="cz-connect-how">{how[c.setup]}</p>
            {c.setup === "token" && c.token && (
              <div className="cz-connect-token">
                <label htmlFor="cz-token" className="set-label">
                  {c.token.label}
                </label>
                <div className="cz-connect-field">
                  <input id="cz-token" className="input" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} />
                  {c.token.create && (
                    <a className="btn" href={c.token.create.url} target="_blank" rel="noreferrer">
                      {c.token.create.label} <ExternalLink size={14} aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            )}
            <div className="cz-connect-actions">
              <button className="btn primary" disabled={busy || (c.setup === "token" && !token.trim())}>
                {busy ? (c.setup === "folder" ? "Choose it in the window that opened…" : "Connecting…") : action[c.setup]}
              </button>
              {c.guide && (
                <a className="cz-guide" href={c.guide} target="_blank" rel="noreferrer">
                  Setup guide <ExternalLink size={14} aria-hidden />
                </a>
              )}
            </div>
            {error && (
              <p className="error small" role="alert">
                {error}
              </p>
            )}
          </form>
        </section>
        <section className="set-group" aria-labelledby="cz-where">
          <h3 id="cz-where">Details</h3>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label">{c.url ? "Address" : "Runs"}</span>
            </div>
            <code className="cz-where">{where}</code>
          </div>
          <div className="set-row">
            <div className="set-text">
              <span className="set-label">Its tools</span>
              <p>Listed once it's connected. Tools that only read run on their own; the rest ask you first. You can change each one.</p>
            </div>
          </div>
        </section>
        <p className="muted small">
          {c.url
            ? `Rails sends Sprockets' calls to ${new URL(c.url).host}. What Sprockets can do there is what your account can.`
            : "Rails runs it as you, on this computer, with the same access as a terminal panel."}
        </p>
      </div>
    </div>
  );
}
