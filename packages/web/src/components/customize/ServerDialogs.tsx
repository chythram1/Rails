import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconExternalLink as ExternalLink, IconPlug as Plug, IconTerminal2 as Terminal, IconX as X } from "@tabler/icons-react";
import { connectorById, MCP_NAME_MAX, type Connector, type McpServer } from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { useStore } from "../../store.tsx";
import { Dropdown } from "../ui/Dropdown.tsx";
import { ConnectorLogo } from "./ConnectorLogo.tsx";
import { isConnected, SignInWaiting } from "./McpEditor.tsx";
import { readPastedConfig, shellWords, type PastedServer } from "./pasteConfig.ts";

/**
 * The frame the add dialogs share (native `<dialog>`, over Customize): a head with a mark, a title and a line, and a
 * close button; a body that scrolls; actions at the foot. Escape, the backdrop and × all close it. It opens on the
 * field marked `data-autofocus`, or else on its last action (the one that does it), not on ×.
 */
function Modal(props: { id: string; mark?: ReactNode; title: string; lead?: string; onClose(): void; onSubmit?(e: FormEvent): void; actions: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = ref.current!;
    d.showModal();
    (d.querySelector<HTMLElement>("[data-autofocus]") ?? [...d.querySelectorAll<HTMLElement>(".cz-dialog-actions :is(button, a)")].pop())?.focus();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="cz-dialog"
      aria-labelledby={`${props.id}-title`}
      aria-describedby={props.lead ? `${props.id}-lead` : undefined}
      onCancel={(e) => (e.preventDefault(), props.onClose())}
      // A click on the backdrop lands on the dialog element itself; the form covers the rest.
      onClick={(e) => e.target === ref.current && props.onClose()}
    >
      <form className="cz-dialog-frame" onSubmit={(e) => (e.preventDefault(), props.onSubmit?.(e))}>
        <header className="cz-dialog-head">
          {props.mark}
          <div className="cz-dialog-titles">
            <h2 id={`${props.id}-title`}>{props.title}</h2>
            {props.lead && <p id={`${props.id}-lead`}>{props.lead}</p>}
          </div>
          <button type="button" className="icon-btn cz-dialog-close" aria-label="Close" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="cz-dialog-body">{props.children}</div>
        <div className="cz-dialog-actions">{props.actions}</div>
      </form>
    </dialog>
  );
}

/** A field in a dialog: its label over the control, and a muted line under it. */
function Field({ id, label, optional, help, children }: { id: string; label: string; optional?: boolean; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="cz-dfield">
      <label htmlFor={id}>
        {label}
        {optional && <span className="cz-dfield-optional">Optional</span>}
      </label>
      {children}
      {help && (
        <p id={`${id}-help`} className="cz-dfield-help">
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * Once it's added, the dialog stays to say how it went: signing in (the page to open), that it needs a sign-in, that
 * it's connected with its tools, or why it can't connect. The server is read from the store, so it follows a sign-in
 * finished in another tab. A connector (`setup`) is only kept once it's connected: closing the dialog before that
 * (Cancel, ×, Escape) removes it, so nothing is left half added.
 */
function Result({ server: s, setup, onClose: close }: { server: McpServer; setup?: Connector["setup"]; onClose(): void }) {
  const { mcpApps } = useStore();
  const [busy, setBusy] = useState(false);
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
  const waiting = !!s.signIn?.authUrl;
  const signedIn = s.signIn?.state === "signed-in";
  const ok = s.status.state === "ok" && s.signIn?.state !== "needed";
  const needsApp = setup === "own-app" && !s.signIn?.clientId && !(s.signIn?.app && mcpApps?.find((a) => a.id === s.signIn!.app)?.clientId);
  const wantsSignIn = !ok && !signedIn && (s.signIn?.state === "needed" || setup === "sign-in" || (setup === "own-app" && !needsApp));
  const tools = s.tools.length;
  const unfinished = !!setup && !isConnected(s);
  const onClose = () => {
    if (unfinished) void api.deleteMcpServer(s.id).catch(() => {});
    close();
  };

  let body: ReactNode;
  if (waiting)
    body = (
      <>
        <p className="cz-dialog-text">Open the sign-in page and allow Rails. This updates once you're back.</p>
        <SignInWaiting server={s} cancel={!unfinished} />
      </>
    );
  else if (ok)
    body = (
      <p className="cz-dialog-state" role="status">
        <span className="cz-dot ok" aria-hidden /> Connected{s.toolsAt ? ` with ${tools} tool${tools === 1 ? "" : "s"}` : ""}. Tools that only read run on their own; the rest ask you
        first. Turn it on for a Sprocket under Tools in its settings.
      </p>
    );
  else if (needsApp)
    body = (
      <p className="cz-dialog-text">
        It's added. To sign in, <a href={s.signIn?.app ? href.mcpApp(s.signIn.app) : href.mcpServer(s.id)}>{s.signIn?.app ? "set up your Google app" : "enter your app's client ID"}</a> first.
      </p>
    );
  else if (wantsSignIn)
    body = (
      <p className="cz-dialog-state" role="status">
        <span className="cz-dot needed" aria-hidden /> {unfinished ? "Sign in to connect it." : "It's added. Sign in to use its tools."}
      </p>
    );
  else if (s.status.state === "error")
    body = (
      <p className="cz-dialog-state" role="status">
        <span className="cz-dot needed" aria-hidden /> {unfinished ? "It can't connect" : "It's added, but it can't connect"}: {s.status.error}
      </p>
    );
  else body = <p className="cz-dialog-text" role="status">Connecting…</p>;

  return (
    <Modal
      id="cz-added"
      mark={<ConnectorLogo server={s} />}
      title={connectorById(s.connector)?.id === s.name ? connectorById(s.connector)!.name : s.name}
      lead={s.description || undefined}
      onClose={onClose}
      actions={
        <>
          {!unfinished && (
            <a className="btn" href={href.mcpServer(s.id)}>
              Open its settings
            </a>
          )}
          <span className="grow" />
          {wantsSignIn && !waiting ? (
            <button type="button" className="btn primary" disabled={busy || !s.url} onClick={() => void run(() => api.signInMcpServer(s.id))}>
              {busy ? "Starting…" : "Sign in"}
            </button>
          ) : !ok && !waiting && s.status.state === "error" ? (
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => api.testMcpServer(s.id))}>
              {busy ? "Trying…" : "Try again"}
            </button>
          ) : null}
          <button type="button" className={ok ? "btn primary" : "btn"} onClick={onClose}>
            {unfinished ? "Cancel" : "Done"}
          </button>
        </>
      }
    >
      {body}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * A connector (shared CONNECTORS), as a dialog over Customize: what it does, how it connects, the one thing it needs
 * (a token, a folder, the Google app), and Connect. Then the dialog says how it went (Result). One added before that
 * never finished connecting (a sign-in left halfway) is picked up again, not added twice.
 */
export function ConnectorDialog({ connector: c, added, onClose }: { connector: Connector; added: McpServer[]; onClose(): void }) {
  const { profile, mcpApps, mcpServers } = useStore();
  const app = c.app ? mcpApps?.find((a) => a.id === c.app) : undefined;
  const needsApp = !!c.app && !app?.clientId;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<McpServer | null>(null);
  if (made) return <Result server={mcpServers?.find((s) => s.id === made.id) ?? made} setup={c.setup} onClose={onClose} />;
  const connected = added.filter(isConnected);
  const halfway = added.find((s) => !isConnected(s));

  const add = async () => {
    if (needsApp || busy || (c.setup === "token" && !token.trim())) return;
    setError("");
    setBusy(true);
    try {
      // A sign-in left halfway: sign in to that one. Anything else unfinished is set up again from the start.
      if (halfway && (c.setup === "sign-in" || c.setup === "own-app")) return setMade(await api.signInMcpServer(halfway.id));
      if (halfway) await api.deleteMcpServer(halfway.id);
      setMade(await api.addConnector(c.id, c.setup === "token" ? { token } : {}));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  const computer = profile?.name ?? "the computer Rails runs on";
  const how: Record<Connector["setup"], string> = {
    "sign-in": `Sign in with your ${c.by} account. Rails keeps the token on this computer and renews it.`,
    none: "No account needed: it works as soon as it's added.",
    token: c.token?.help ?? "",
    "own-app": c.app
      ? needsApp
        ? "Google lets no app register itself: set up your Google app once (about ten minutes), and every Google connector signs in with it."
        : "Sign in with your Google account, through the Google app you set up."
      : "Register an app with the service, then enter its client ID and secret in its settings. They show the redirect address to give the app.",
    folder: `Pick the folder it may use. The picker opens on ${computer}'s screen.`,
  };
  const action: Record<Connector["setup"], string> = { "sign-in": "Connect", none: "Connect", token: "Connect", "own-app": c.app ? "Connect" : "Add it", folder: "Choose a folder…" };
  const where = c.url ?? [c.command, ...(c.args ?? []), c.setup === "folder" ? "<folder>" : ""].filter(Boolean).join(" ");

  return (
    <Modal
      id="cz-conn"
      mark={<ConnectorLogo id={c.id} />}
      title={c.name}
      lead={c.description}
      onClose={onClose}
      onSubmit={() => void add()}
      actions={
        <>
          {c.guide && (
            <a className="cz-guide" href={c.guide} target="_blank" rel="noreferrer">
              Setup guide <ExternalLink size={14} aria-hidden />
            </a>
          )}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {needsApp ? (
            <a className="btn primary" href={href.mcpApp(c.app!)}>
              Set up your Google app
            </a>
          ) : (
            <button className="btn primary" disabled={busy || (c.setup === "token" && !token.trim())}>
              {busy ? (c.setup === "folder" ? "Choose it in the window that opened…" : "Connecting…") : action[c.setup]}
            </button>
          )}
        </>
      }
    >
      {c.about && <p className="cz-dialog-text">{c.about}</p>}
      <p className="cz-dialog-text">{how[c.setup]}</p>
      {connected.length > 0 && (
        <p className="cz-dialog-note" role="status">
          Already connected:{" "}
          {connected.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <a href={href.mcpServer(s.id)}>{s.name}</a>
            </span>
          ))}
          . Adding it again makes another.
        </p>
      )}
      {c.setup === "token" && c.token && (
        <Field
          id="cz-token"
          label={c.token.label}
          help={
            c.token.create && (
              <a href={c.token.create.url} target="_blank" rel="noreferrer">
                {c.token.create.label} <ExternalLink size={12} aria-hidden />
              </a>
            )
          }
        >
          <input id="cz-token" className="input" type="password" autoComplete="off" spellCheck={false} data-autofocus value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
      )}
      <div className="cz-dfield">
        <span className="cz-dlabel">{c.url ? "Address" : "Runs"}</span>
        <code className="cz-dialog-code">{where}</code>
      </div>
      <p className="cz-dfield-help">
        {c.url
          ? `Rails sends Sprockets' calls to ${new URL(c.url).host}. What Sprockets can do there is what your account can.`
          : "Rails runs it as you, on this computer, with the same access as a terminal panel."}
      </p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** A variable or header of a new server: its name, its value, and whether a pasted config left it to fill in. */
interface SecretRow {
  key: number;
  name: string;
  value: string;
  missing?: boolean;
}

/**
 * Any other MCP server, as a dialog: on the web (a URL and headers) or a program here (a command and its variables),
 * filled in by hand or from a pasted config. Add server creates it and connects; then the dialog says how it went.
 */
export function CustomServerDialog({ transport: first, onClose }: { transport: "http" | "stdio"; onClose(): void }) {
  const { mcpServers } = useStore();
  const [transport, setTransport] = useState(first);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const nextKey = useRef(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<McpServer | null>(null);
  if (made) return <Result server={mcpServers?.find((s) => s.id === made.id) ?? made} onClose={onClose} />;

  const web = transport === "http";
  const add = async () => {
    if (!target.trim() || busy) return;
    setError("");
    setBusy(true);
    try {
      const values = Object.fromEntries(secrets.filter((r) => r.name.trim() && r.value).map((r) => [r.name.trim(), r.value]));
      const [command = "", ...args] = web ? [] : shellWords(target.trim());
      const created = await api.createMcpServer(
        web ? { transport, name: name.trim() || undefined, url: target.trim(), headers: values } : { transport, name: name.trim() || undefined, command, args, env: values },
      );
      setMade(created);
      // Connect now, so the dialog can say whether it works (or needs a sign-in).
      await api.testMcpServer(created.id).catch(() => {});
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  /** Fill the form from a server read from a pasted config. */
  const fill = (p: PastedServer) => {
    setTransport(p.transport);
    setName(p.name);
    setTarget(p.transport === "http" ? p.url : [p.command, ...p.args].map((w) => (/[\s"']/.test(w) ? JSON.stringify(w) : w)).join(" "));
    const values = p.transport === "http" ? p.headers : p.env;
    setSecrets(Object.entries(values).map(([k, v]) => ({ key: nextKey.current++, name: k, value: v, missing: p.missing.includes(k) })));
  };
  const setSecret = (key: number, change: Partial<SecretRow>) => setSecrets((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const unfilled = secrets.filter((r) => r.missing && !r.value).map((r) => r.name);

  return (
    <Modal
      id="cz-custom"
      title="Add a custom server"
      lead="Any MCP server: one on the web by its URL, or a program Rails runs on this computer."
      onClose={onClose}
      onSubmit={() => void add()}
      actions={
        <>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !target.trim()}>
            {busy ? "Adding…" : "Add server"}
          </button>
        </>
      }
    >
      <PasteConfig onFill={fill} />
      <Field id="cz-custom-type" label="Server type">
        <Dropdown
          id="cz-custom-type"
          value={transport}
          options={[
            { value: "http", label: "On the web, by its URL", icon: <Plug size={16} /> },
            { value: "stdio", label: "A program on this computer", icon: <Terminal size={16} /> },
          ]}
          onChange={(v) => setTransport(v as "http" | "stdio")}
        />
      </Field>
      <Field id="cz-custom-name" label="Name" optional help="Lowercase letters, digits, - and _. Its tools are called name_tool.">
        <input id="cz-custom-name" className="input" maxLength={MCP_NAME_MAX} placeholder={web ? "tracker" : "notes"} value={name} aria-describedby="cz-custom-name-help" onChange={(e) => setName(e.target.value)} />
      </Field>
      {web ? (
        <Field id="cz-custom-target" label="URL" help="Its Streamable HTTP endpoint. Sign in after, if it asks.">
          <input id="cz-custom-target" className="input" type="url" data-autofocus placeholder="https://example.com/mcp" value={target} aria-describedby="cz-custom-target-help" onChange={(e) => setTarget(e.target.value)} />
        </Field>
      ) : (
        <Field id="cz-custom-target" label="Command" help="As you'd type it in a terminal, with its arguments.">
          <input
            id="cz-custom-target"
            className="input cz-mono"
            spellCheck={false}
            data-autofocus
            placeholder="npx -y @modelcontextprotocol/server-filesystem ~/notes"
            value={target}
            aria-describedby="cz-custom-target-help"
            onChange={(e) => setTarget(e.target.value)}
          />
        </Field>
      )}
      <div className="cz-dfield">
        <span className="cz-dlabel" id="cz-custom-secrets">
          {web ? "Headers" : "Environment"}
          <span className="cz-dfield-optional">Optional</span>
        </span>
        {secrets.map((r) => (
          <div key={r.key} className="cz-drow">
            <input className="input cz-mono" aria-label={web ? "Header name" : "Variable name"} placeholder={web ? "Authorization" : "API_KEY"} value={r.name} onChange={(e) => setSecret(r.key, { name: e.target.value })} />
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
        <div>
          <button type="button" className="btn small" onClick={() => setSecrets((rows) => [...rows, { key: nextKey.current++, name: "", value: "" }])}>
            {web ? "Add a header" : "Add a variable"}
          </button>
        </div>
        <p className="cz-dfield-help">{web ? "Sent with every request, such as an API key." : "Variables it starts with, such as API keys."} Values stay on the server once it's added.</p>
        {unfilled.length > 0 && (
          <p className="cz-dfield-help" role="status">
            The config left {unfilled.join(", ")} for you to fill in.
          </p>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * Paste a server's config from its README (the mcpServers JSON, a claude mcp add or codex mcp add line, or Codex's
 * TOML) and fill the form from it. With several servers in it, pick which. Folded until opened.
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
    <details className="cz-paste">
      <summary>Paste a config from its README</summary>
      <div className="cz-dfield">
        <label htmlFor="cz-paste" className="sr-only">
          Config
        </label>
        <textarea
          id="cz-paste"
          className="input cz-mono"
          rows={4}
          spellCheck={false}
          value={text}
          aria-describedby="cz-paste-help"
          onChange={(e) => setText(e.target.value)}
          placeholder={'{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "…"] } } }'}
        />
        <p id="cz-paste-help" className="cz-dfield-help">
          Its JSON (with mcpServers), a claude mcp add or codex mcp add line, or Codex's TOML.
        </p>
        <div className="cz-drow">
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
          <p className="cz-dfield-help" role="status">
            {note}
          </p>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
