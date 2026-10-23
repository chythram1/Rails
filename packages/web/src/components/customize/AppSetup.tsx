import { useState, type FormEvent, type ReactNode } from "react";
import { IconExternalLink as ExternalLink } from "@tabler/icons-react";
import { CONNECTORS, type McpApp } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { EditorHead } from "./fields.tsx";

/** Google's connectors, which sign in with the one app. */
const GOOGLE = CONNECTORS.filter((c) => c.app === "google");
/** The APIs to turn on, and their MCP services (Google's guide, "Enable the APIs" and "Enable the MCP services"). */
const GOOGLE_APIS = [
  "drive.googleapis.com",
  "sheets.googleapis.com",
  "calendar-json.googleapis.com",
  "gmail.googleapis.com",
  "drivemcp.googleapis.com",
  "sheetsmcp.googleapis.com",
  "calendarmcp.googleapis.com",
  "gmailmcp.googleapis.com",
];
const CONSOLE = "https://console.cloud.google.com";

/** A link out to a Google page, marked as leaving Rails. */
const Out = ({ to, children }: { to: string; children: ReactNode }) => (
  <a href={to} target="_blank" rel="noreferrer">
    {children} <ExternalLink size={13} aria-hidden />
  </a>
);

/**
 * The user's Google app (ADR 0025): Google lets no app register itself, so each person registers one in Google Cloud,
 * once, and every Google connector signs in with it. The steps, each with a link to its page, then its client ID and
 * secret.
 */
export function AppSetup({ app }: { app: McpApp }) {
  const { mcpServers } = useStore();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scopes = [...new Set(GOOGLE.flatMap((c) => c.scopes ?? []))];
  const ready = !!app.clientId;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.setMcpApp(app.id, { ...(clientId.trim() ? { clientId: clientId.trim() } : {}), ...(secret ? { clientSecret: secret } : {}) });
      setClientId("");
      setSecret("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setError("");
    try {
      await api.setMcpApp(app.id, { clientId: null, clientSecret: null });
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="cz-editor">
      <EditorHead back={href.customize("connectors")} backLabel="Connectors" title="Your Google app" />
      <div className="cz-body">
        <p className="cz-about">
          <span className="cz-about-lead">Google lets no app register itself, so you register one for Rails in Google Cloud, once.</span> It takes about ten
          minutes. After it, Drive, Sheets, Calendar and Gmail are each one sign-in with your Google account. Google's MCP servers are in preview: your
          account has to be in its Workspace Developer Preview Program.
        </p>

        <section className="set-group" aria-labelledby="cz-app-state">
          <h3 id="cz-app-state">Your app</h3>
          <p className="cz-status cz-app-status" role="status">
            <span className={"cz-dot" + (ready ? " ok" : "")} aria-hidden />
            {ready ? (
              <>
                Set up: client ID <code className="cz-mono">{app.clientId}</code>
                {app.clientSecret ? " and its secret." : ", no secret."}
              </>
            ) : (
              "Not set up yet."
            )}
          </p>
          {ready && (
            <ul className="cz-app-connectors">
              {GOOGLE.map((c) => {
                const added = (mcpServers ?? []).find((s) => s.connector === c.id);
                return (
                  <li key={c.id}>
                    <ConnectorLogo id={c.id} size={24} />
                    <a href={added ? href.mcpServer(added.id) : href.connector(c.id)}>{c.name}</a>
                    <span className="muted small">{added ? (added.signIn?.state === "signed-in" ? "Signed in" : "Added") : "Connect it"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="set-group" aria-labelledby="cz-app-steps">
          <h3 id="cz-app-steps">{ready ? "How it was set up" : "Set it up"}</h3>
          <ol className="cz-steps">
            <li>
              Join Google's <Out to="https://developers.google.com/workspace/preview">Workspace Developer Preview Program</Out> with the account you'll sign
              in with.
            </li>
            <li>
              <Out to={`${CONSOLE}/projectcreate`}>Create a Google Cloud project</Out>, or pick one you have.
            </li>
            <li>
              <Out to={`${CONSOLE}/flows/enableapi?apiid=${GOOGLE_APIS.join(",")}`}>Turn on the APIs and their MCP services</Out> for Drive, Sheets, Calendar
              and Gmail, in that project.
            </li>
            <li>
              Set up the consent screen: in <Out to={`${CONSOLE}/auth/branding`}>Branding</Out>, name the app Rails and give your email. In{" "}
              <Out to={`${CONSOLE}/auth/audience`}>Audience</Out>, pick Internal if you can; if not, External, and add yourself under Test users.
            </li>
            <li>
              In <Out to={`${CONSOLE}/auth/scopes`}>Data Access</Out>, choose Add or Remove Scopes, paste these under Manually add scopes, then Add to Table,
              Update and Save:
              <code className="cz-redirect cz-scopes">{scopes.join("\n")}</code>
            </li>
            <li>
              <Out to={`${CONSOLE}/auth/clients/create`}>Create a client</Out>: a Web application named Rails, with this under Authorized redirect URIs. Tick
              Use this client for an AI-powered agent, then Create.
              <code className="cz-redirect">{app.redirectUrl}</code>
            </li>
            <li>Copy its client ID and client secret into the fields below.</li>
          </ol>
        </section>

        <form className="set-group" aria-labelledby="cz-app-client" onSubmit={(e) => void save(e)}>
          <h3 id="cz-app-client">Client ID and secret</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-app-id">Client ID</label>
              {ready && <p>Paste a new one to replace it.</p>}
            </div>
            <input id="cz-app-id" className="input cz-mono" autoComplete="off" spellCheck={false} placeholder={app.clientId ?? "…apps.googleusercontent.com"} value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </div>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-app-secret">Client secret</label>
              <p>{app.clientSecret ? "Set. It stays on the server: you can replace it, not read it." : "Kept on the server."}</p>
            </div>
            <input id="cz-app-secret" className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          <div className="sp-field-foot">
            {ready && (
              <button type="button" className="btn small" onClick={() => void remove()}>
                Remove the app
              </button>
            )}
            <span className="grow" />
            <button className="btn small primary" disabled={busy || (!clientId.trim() && !secret) || (!ready && !clientId.trim())}>
              Save
            </button>
          </div>
          {ready && <p className="muted small">Changing or removing it signs the Google connectors that use it out.</p>}
        </form>
      </div>
    </div>
  );
}
