import { useState, type FormEvent } from "react";
import { IconDots as Dots, IconExternalLink as ExternalLink } from "@tabler/icons-react";
import { connectorById, MCP_DESCRIPTION_MAX, MCP_NAME_MAX, type McpServer, type McpServerInput, type McpSignIn, type McpToolPolicy } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { timeAgo } from "../../util.ts";
import { MenuButton } from "../Menu.tsx";
import { Segmented } from "../Segmented.tsx";
import { useSprockets } from "../sprockets/useSprockets.ts";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { EditorHead, LongText, TextInput } from "./fields.tsx";
import { useConfirm } from "../ConfirmDialog.tsx";

/** A server in a line, for the list: its tools, or why it can't connect. */
export function serverSummary(s: McpServer): string {
  if (s.signIn?.state === "needed") return "Sign in to use its tools";
  if (s.status.state === "error") return s.status.error ?? "Can't connect";
  if (!s.toolsAt) return s.transport === "http" ? s.url || "No URL yet" : s.command ? [s.command, ...s.args].join(" ") : "No command yet";
  return `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}${s.usedBy.length ? ` · ${s.usedBy.length} Sprocket${s.usedBy.length === 1 ? "" : "s"}` : ""}`;
}

const POLICIES: { value: McpToolPolicy; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "off", label: "Off" },
];

/**
 * One MCP server (ADR 0025): how Rails starts or reaches it, its secret values (names only: values never come
 * back), Test, its tools with allow, ask or off, and the Sprockets that have it.
 */
export function McpEditor({ server: s }: { server: McpServer }) {
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const { list: sprockets } = useSprockets();

  const save = async (body: McpServerInput) => {
    setError("");
    try {
      await api.updateMcpServer(s.id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };
  const test = async () => {
    setError("");
    setTesting(true);
    try {
      await api.testMcpServer(s.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTesting(false);
    }
  };
  const [confirmDialog, ask] = useConfirm();
  const remove = () =>
    ask({
      title: `Remove ${s.name}?`,
      text: "Sprockets that have it lose its tools.",
      action: "Remove",
      danger: true,
      // It opened from the `…` menu, whose item is gone: back to the menu's button.
      returnFocus: () => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`${s.name} actions`)}"]`),
      onConfirm: async () => {
        await api.deleteMcpServer(s.id);
        navigate(href.customize("connectors"));
      },
    });
  const local = s.transport === "stdio";
  const connector = connectorById(s.connector);
  const users = (sprockets ?? []).filter((x) => s.usedBy.includes(x.id));

  // How it connects (shown first for a custom server, folded away under a connector's tools).
  const settings = (
    <>
      <section className="set-group" aria-labelledby="cz-mcp-title">
        <h3 id="cz-mcp-title">Server</h3>
        <div className="set-row">
          <div className="set-text">
            <label htmlFor="cz-mcp-name">Name</label>
            <p>Lowercase. Its tools are called {s.name}_<em>tool</em>.</p>
          </div>
          <TextInput id="cz-mcp-name" value={s.name} maxLength={MCP_NAME_MAX} onSave={(v) => save({ name: v })} />
        </div>
        <div className="set-row">
          <div className="set-text">
            <label htmlFor="cz-mcp-desc">What it's for</label>
            <p>Sprockets see this beside its tools.</p>
          </div>
          <TextInput id="cz-mcp-desc" value={s.description} maxLength={MCP_DESCRIPTION_MAX} placeholder="e.g. Our issue tracker" onSave={(v) => save({ description: v })} />
        </div>
        <div className="set-row">
          <div className="set-text">
            <span className="set-label" id="cz-mcp-transport">Runs as</span>
            <p>{local ? "A program on this computer, started by Rails." : "A service Rails reaches over HTTP."}</p>
          </div>
          <Segmented
            name="cz-mcp-transport"
            aria-labelledby="cz-mcp-transport"
            value={s.transport}
            options={[
              { value: "stdio", label: "Command" },
              { value: "http", label: "URL" },
            ]}
            onChange={(v) => void save({ transport: v })}
          />
        </div>
        {local ? (
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-mcp-command">Command</label>
              <p>The program, as you'd type it (npx, uvx, a path).</p>
            </div>
            <TextInput id="cz-mcp-command" value={s.command} maxLength={500} placeholder="npx" onSave={(v) => save({ command: v })} />
          </div>
        ) : (
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-mcp-url">URL</label>
              <p>Its Streamable HTTP endpoint.</p>
            </div>
            <TextInput id="cz-mcp-url" value={s.url} maxLength={1000} placeholder="https://example.com/mcp" onSave={(v) => save({ url: v })} />
          </div>
        )}
      </section>
      {local && (
        <LongText
          id="cz-mcp-args"
          label="Arguments"
          help="One per line."
          value={s.args.join("\n")}
          rows={3}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/Users/you/notes"}
          onSave={(v) => save({ args: v.split("\n").map((a) => a.trim()).filter(Boolean) })}
        />
      )}
      <Secrets
        kind={local ? "env" : "headers"}
        names={local ? s.env : s.headers}
        onSave={(values) => save(local ? { env: values } : { headers: values })}
      />
    </>
  );
  const tools = <Tools server={s} onSave={(policies) => save({ policies })} />;
  // Sign-in for a server with a URL: always for a custom one; for a connector, if it signs in or asked to.
  const setup = connector?.setup;
  const showSignIn = !!s.signIn && (!connector || setup === "sign-in" || setup === "own-app" || s.signIn.state !== "none");

  return (
    <div className="cz-editor">
      {confirmDialog}
      <EditorHead back={href.customize("connectors")} backLabel="Connectors">
        <button type="button" className="btn small" disabled={testing} onClick={() => void test()}>
          {testing ? "Connecting…" : "Test"}
        </button>
        <MenuButton label={`${s.name} actions`} title="More" icon={<Dots size={18} />} align="right" items={[{ label: "Remove", danger: true, onSelect: () => void remove() }]} />
      </EditorHead>
      <div className="cz-body">
        <header className="cz-hero">
          <ConnectorLogo server={s} size={64} />
          <div className="cz-hero-text">
            <h1 className="cz-hero-name">{connector && s.name === connector.id ? connector.name : s.name}</h1>
            <p className="cz-hero-by">{connector ? `by ${connector.by}` : local ? "Custom server · a command" : "Custom server · a URL"}</p>
            <Status server={s} />
          </div>
        </header>
        {connector ? (
          <>
            {showSignIn && <SignIn server={s} signIn={s.signIn!} onSave={save} />}
            {tools}
          </>
        ) : (
          <>
            {settings}
            {showSignIn && <SignIn server={s} signIn={s.signIn!} onSave={save} />}
            {tools}
          </>
        )}
        <section className="set-group" aria-labelledby="cz-mcp-users">
          <h3 id="cz-mcp-users">Sprockets with it</h3>
          {users.length ? (
            <ul className="cz-uses">
              {users.map((u) => (
                <li key={u.id}>
                  <a href={href.sprocketSettings(u.id)}>{u.name}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="set-intro">None yet. Give it to a Sprocket in that Sprocket's settings, under Tools.</p>
          )}
        </section>
        {connector && (
          <details className="cz-advanced">
            <summary>Connection settings</summary>
            <div className="cz-advanced-body">{settings}</div>
          </details>
        )}
        <p className="muted small">
          {local
            ? "Rails runs the command as you, on this computer, with the same access as a terminal panel. Add only servers you trust."
            : "Rails sends its tools' calls to this URL, with the headers in its settings. Add only services you trust."}
        </p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** Whether the last connection worked, and when. */
function Status({ server: s }: { server: McpServer }) {
  const setup = connectorById(s.connector)?.setup;
  const { mcpApps } = useStore();
  const shared = s.signIn?.app && mcpApps?.find((a) => a.id === s.signIn!.app)?.clientId;
  if (s.status.state !== "ok" && s.signIn?.state !== "signed-in" && (setup === "sign-in" || setup === "own-app"))
    return (
      <p className="cz-status small" role="status">
        <span className="cz-dot needed" aria-hidden />{" "}
        {setup === "own-app" && !s.signIn?.clientId && !shared ? (
          s.signIn?.app ? (
            <>
              <a href={href.mcpApp(s.signIn.app)}>Set up your Google app</a>, then sign in.
            </>
          ) : (
            "Set up your app, then sign in."
          )
        ) : (
          "Sign in to connect it."
        )}
      </p>
    );
  const count = (p: McpToolPolicy) => s.tools.filter((t) => t.policy === p).length;
  const split = [
    [count("allow"), "allowed"],
    [count("ask"), "ask first"],
    [count("off"), "off"],
  ].filter(([n]) => n) as [number, string][];
  if (s.status.state === "unknown") return <p className="cz-status muted small">Not connected yet. Test it to list its tools.</p>;
  if (s.signIn?.state === "needed")
    return (
      <p className="cz-status small" role="status">
        <span className="cz-dot needed" aria-hidden /> It needs you to sign in. Sign in below{s.tools.length ? " to use its tools." : "."}
      </p>
    );
  if (s.status.state === "error")
    return (
      <p className="cz-status error small" role="status">
        Can't connect{s.status.at ? ` (${timeAgo(s.status.at)})` : ""}: {s.status.error}
      </p>
    );
  return (
    <p className="cz-status small" role="status">
      <span className="cz-dot ok" aria-hidden />
      <span>
        Connected{s.status.at ? ` ${timeAgo(s.status.at)}` : ""}
        <span className="muted">
          {" · "}
          {s.tools.length} tool{s.tools.length === 1 ? "" : "s"}
          {split.length > 1 && `: ${split.map(([n, what]) => `${n} ${what}`).join(", ")}`}
        </span>
      </span>
    </p>
  );
}

/**
 * Signing in to a remote server (OAuth, ADR 0025): whether Rails is signed in, Sign in or Sign out, and while a
 * sign-in runs, the service's page to open and a field for the address the browser lands on (from another device
 * that page won't load). Under "Your own app", the client ID and secret for services that don't let apps
 * register themselves, and the redirect address to give them.
 */
function SignIn({ server: s, signIn, onSave }: { server: McpServer; signIn: McpSignIn; onSave(body: McpServerInput): Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const paste = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.pasteMcpSignIn(s.id, address);
      setAddress("");
    });
  };
  const waiting = !!signIn.authUrl;
  const state =
    signIn.state === "signed-in" ? (
      <>
        <span className="cz-dot ok" aria-hidden /> Signed in
      </>
    ) : signIn.state === "needed" ? (
      <>
        <span className="cz-dot needed" aria-hidden /> It asks you to sign in
      </>
    ) : (
      "Not signed in"
    );

  return (
    <section className="set-group" aria-labelledby="cz-signin">
      <h3 id="cz-signin">Sign-in</h3>
      <p className="set-intro">For services that sign you in with your account (OAuth). Rails keeps the token on this computer and renews it.</p>
      <div className="set-row">
        <div className="set-text">
          <span className="set-label">Account</span>
          <p className="cz-signin-state" role="status">
            {waiting ? "Signing in…" : state}
          </p>
        </div>
        {signIn.state === "signed-in" && !waiting ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => void run(() => api.signOutMcpServer(s.id))}>
            Sign out
          </button>
        ) : (
          !waiting && (
            <button type="button" className="btn small primary" disabled={busy || !s.url} onClick={() => void run(() => api.signInMcpServer(s.id))}>
              {busy ? "Starting…" : "Sign in"}
            </button>
          )
        )}
      </div>
      {waiting && (
        <div className="cz-signin-flow">
          <div className="cz-signin-actions">
            <a className="btn small primary" href={signIn.authUrl} target="_blank" rel="noreferrer">
              Open the sign-in page <ExternalLink size={14} aria-hidden />
            </a>
            <button type="button" className="btn small" onClick={() => void run(() => api.cancelMcpSignIn(s.id))}>
              Cancel
            </button>
          </div>
          <form className="cz-signin-paste" onSubmit={paste}>
            <label htmlFor="cz-signin-address" className="muted small">
              Signing in on another device? When you're done, the page you land on won't load. Paste its address here.
            </label>
            <div className="cz-signin-row">
              <input
                id="cz-signin-address"
                className="input"
                placeholder={`${signIn.redirectUrl}?code=…`}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button className="btn small" disabled={busy || !address.trim()}>
                Continue
              </button>
            </div>
          </form>
        </div>
      )}
      {(error || signIn.error) && (
        <p className="error small cz-signin-error" role="alert">
          {error || signIn.error}
        </p>
      )}
      <details className="cz-signin-app" open={!!signIn.clientId || /register themselves/.test(signIn.error ?? "")}>
        <summary>Your own app</summary>
        <p className="set-intro">
          {signIn.app ? (
            <>
              It signs in with <a href={href.mcpApp(signIn.app)}>your Google app</a>, which every Google connector shares. An app set here is for this one
              only, in its place.
            </>
          ) : (
            "Some services (Google's, for one) don't let apps register themselves. Register an app with the service, give it the redirect address below, and enter its client ID and secret here."
          )}
        </p>
        <div className="set-row cz-redirect-row">
          <div className="set-text">
            <span className="set-label" id="cz-signin-redirect">
              Redirect address
            </span>
            <p>Where the service sends you back. Give it this exactly.</p>
          </div>
          <code className="cz-redirect" aria-labelledby="cz-signin-redirect">
            {signIn.redirectUrl}
          </code>
        </div>
        <div className="set-row">
          <div className="set-text">
            <label htmlFor="cz-signin-client">Client ID</label>
          </div>
          <TextInput id="cz-signin-client" value={signIn.clientId ?? ""} maxLength={500} placeholder="From the service's developer settings" onSave={(v) => onSave({ clientId: v || null })} />
        </div>
        <form
          className="set-row"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ clientSecret: secret }).then((ok) => ok && setSecret(""));
          }}
        >
          <div className="set-text">
            <label htmlFor="cz-signin-secret">Client secret</label>
            <p>{signIn.clientSecret ? "Set. Values stay on the server: you can replace it, not read it." : "If the service gave it one."}</p>
          </div>
          <span className="cz-signin-row cz-signin-secret">
            <input
              id="cz-signin-secret"
              className="input"
              type="password"
              autoComplete="off"
              placeholder={signIn.clientSecret ? "Replace it" : "Secret"}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            {secret ? (
              <button className="btn small">Save</button>
            ) : (
              signIn.clientSecret && (
                <button type="button" className="btn small" onClick={() => void onSave({ clientSecret: null })}>
                  Remove
                </button>
              )
            )}
          </span>
        </form>
      </details>
    </section>
  );
}

/**
 * Environment variables or headers: their names with Remove (values stay on the server), and a row to add or
 * replace one.
 */
function Secrets({ kind, names, onSave }: { kind: "env" | "headers"; names: string[]; onSave(values: Record<string, string | null>): Promise<boolean> }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const label = kind === "env" ? "Environment" : "Headers";
  const add = async () => {
    if (!name.trim() || !value) return;
    if (await onSave({ [name.trim()]: value })) {
      setName("");
      setValue("");
    }
  };
  return (
    <section className="set-group" aria-labelledby={`cz-${kind}`}>
      <h3 id={`cz-${kind}`}>{label}</h3>
      <p className="set-intro">
        {kind === "env" ? "Variables it starts with, such as API keys." : "Sent with every request, such as Authorization."} Values stay on the
        server: you can replace one, not read it.
      </p>
      {names.map((n) => (
        <div key={n} className="set-row">
          <div className="set-text">
            <span className="set-label cz-mono">{n}</span>
            <p>Set</p>
          </div>
          <button type="button" className="btn small" onClick={() => void onSave({ [n]: null })} aria-label={`Remove ${n}`}>
            Remove
          </button>
        </div>
      ))}
      <form
        className="set-row cz-secret-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input cz-mono" aria-label={kind === "env" ? "Variable name" : "Header name"} placeholder={kind === "env" ? "API_KEY" : "Authorization"} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" type="password" autoComplete="off" aria-label="Value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn small" disabled={!name.trim() || !value}>
          {names.includes(name.trim()) ? "Replace" : "Add"}
        </button>
      </form>
    </section>
  );
}

/**
 * Its tools, each with what Sprockets may do: allow, ask first, or off. Split into the tools that can change things
 * and the read-only ones (as the server marks them), each group with a control that sets all of its tools at once.
 */
function Tools({ server: s, onSave }: { server: McpServer; onSave(policies: Record<string, McpToolPolicy>): Promise<boolean> }) {
  const groups = [
    { id: "acts", title: "Can change things", tools: s.tools.filter((t) => !t.readOnly) },
    { id: "reads", title: "Read-only", tools: s.tools.filter((t) => t.readOnly) },
  ].filter((g) => g.tools.length);
  return (
    <section className="set-group" aria-labelledby="cz-tools">
      <h3 id="cz-tools">Tools</h3>
      <p className="set-intro">
        Allow runs a tool when a Sprocket calls it, Ask shows you the call first with Allow and Deny, and Off hides it. Read-only tools start as
        Allow, the rest as Ask.
      </p>
      {!s.tools.length && <p className="set-intro">{s.toolsAt ? "It has no tools." : s.signIn && s.signIn.state !== "signed-in" && s.connector ? "Sign in to list its tools." : "Test it to list its tools."}</p>}
      {groups.map((g) => {
        const first = g.tools[0].policy;
        const same = g.tools.every((t) => t.policy === first) ? first : ("mixed" as McpToolPolicy);
        return (
          <div key={g.id} className="cz-toolgroup" role="group" aria-labelledby={`cz-tools-${g.id}`}>
            <div className="cz-toolgroup-head">
              <span className="cz-toolgroup-title" id={`cz-tools-${g.id}`}>
                {g.title} <span className="cz-count">{g.tools.length}</span>
              </span>
              {g.tools.length > 1 && (
                <span className="cz-toolgroup-all">
                  <span className="muted small" id={`cz-tools-all-${g.id}`}>
                    All
                  </span>
                  <Segmented
                    small
                    name={`cz-tools-all-${g.id}`}
                    aria-labelledby={`cz-tools-all-${g.id} cz-tools-${g.id}`}
                    value={same}
                    options={POLICIES}
                    onChange={(v) => void onSave(Object.fromEntries(g.tools.map((t) => [t.name, v])))}
                  />
                </span>
              )}
            </div>
            <ul className="cz-tools">
              {g.tools.map((t) => (
                <li key={t.name} className="cz-tool">
                  <div className="cz-tool-text">
                    <span className="cz-tool-name" id={`cz-tool-${t.name}`}>{t.name}</span>
                    {t.description && (
                      <p className="cz-tool-desc" title={t.description}>
                        {t.description}
                      </p>
                    )}
                  </div>
                  <Segmented small name={`cz-tool-${t.name}`} aria-labelledby={`cz-tool-${t.name}`} value={t.policy} options={POLICIES} onChange={(v) => void onSave({ [t.name]: v })} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
