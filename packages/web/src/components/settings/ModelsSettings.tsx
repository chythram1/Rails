import { useEffect, useState, type FormEvent } from "react";
import { IconCheck as Check } from "@tabler/icons-react";
import type { ModelProvider, SignIn } from "@rails/shared";
import { api } from "../../api.ts";
import { socket } from "../../ws.ts";
import { ModelSelect, useModelSettings } from "../ModelSelect.tsx";
import { DecisionsSettings } from "./DecisionsSettings.tsx";

/**
 * Settings → Models (ADR 0006): the default model, the fast decision model (ADR 0012), and the providers they
 * run on, set up with an API key or a sign-in. One row per provider with its status and an action, like Claude's Connectors and
 * the provider lists in Braintrust and Retool. Keys and tokens stay on the server; the page only learns
 * which are set.
 */
export function ModelsSettings() {
  const { settings, error } = useModelSettings();
  const [saveError, setSaveError] = useState("");

  if (!settings) return error ? <p className="error" role="alert">{error}</p> : null;

  const setDefault = async (ref: string | null) => {
    setSaveError("");
    try {
      await api.setDefaultModel(ref);
    } catch (e: any) {
      setSaveError(e.message);
    }
  };

  return (
    <>
      <section className="set-group" aria-labelledby="sprockets-title">
        <h3 id="sprockets-title">Sprockets</h3>
        <div className="set-row" id="setting-default-model" data-settings-row tabIndex={-1}>
          <div className="set-text">
            <label htmlFor="default-model">Default model</label>
            <p>Used by Sprockets that don't pick their own.</p>
          </div>
          <ModelSelect
            id="default-model"
            settings={settings}
            value={settings.defaultModel}
            empty={settings.models.length ? "None" : "Set up a provider first"}
            disabled={!settings.models.length}
            onChange={(ref) => void setDefault(ref)}
          />
        </div>
        {saveError && <p className="error" role="alert">{saveError}</p>}
      </section>

      <DecisionsSettings settings={settings} />

      <section className="set-group" aria-labelledby="providers-title">
        <h3 id="providers-title">Providers</h3>
        <p className="set-intro">Keys and sign-ins are stored on the computer running Rails, never in the browser.</p>
        <ul className="provider-list" aria-label="Providers">
          {settings.providers.map((p) => (
            <ProviderRow key={p.id} provider={p} />
          ))}
        </ul>
      </section>
    </>
  );
}

function status(p: ModelProvider): string {
  if (!p.auth) return "Not set up";
  if (p.auth.type === "api_key") return "API key";
  return p.id === "openai" ? "Using ChatGPT plan" : "Signed in";
}

function ProviderRow({ provider: p }: { provider: ModelProvider }) {
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [signIn, setSignIn] = useState<SignIn | null>(null);

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const { note } = await api.setProviderKey(p.id, key);
      setNote(note ?? "");
      setAdding(false);
      setKey("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove ${p.name}? Sprockets that use its models stop replying until you pick another model.`)) return;
    try {
      await api.removeProvider(p.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startSignIn = async (fresh = false) => {
    setError("");
    try {
      setSignIn(await api.startSignIn(p.id, fresh));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <li className="provider-row" id={`setting-provider-${p.id}`} data-settings-row tabIndex={-1}>
      <div className="provider-main">
        <span className="provider-name">{p.name}</span>
        <span className={"provider-status" + (p.auth ? " ok" : "")}>
          {p.auth && <Check size={14} stroke={2.5} aria-hidden />}
          {status(p)}
        </span>
        {p.auth?.type === "oauth" && p.id === "openai" && (
          <a className="small" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
            Manage usage
          </a>
        )}
        {/* One group at the end of the row: on a narrow screen it wraps as a whole and stays on the right. */}
        <span className="provider-actions">
          {p.auth ? (
            <button className="btn small" onClick={() => void remove()}>Remove</button>
          ) : (
            !adding &&
            !signIn && (
              <>
                {p.signIn && (
                  <button className="btn small" onClick={() => void startSignIn()}>
                    {p.signIn}
                  </button>
                )}
                <button className="btn small" onClick={() => setAdding(true)}>Add API key</button>
              </>
            )
          )}
        </span>
      </div>
      {adding && (
        <form className="provider-form" onSubmit={(e) => void saveKey(e)}>
          <label className="sr-only" htmlFor={`key-${p.id}`}>{p.name} API key</label>
          <input
            id={`key-${p.id}`}
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`${p.name} API key`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
          />
          <button className="btn small primary" disabled={busy || !key.trim()}>{busy ? "Checking…" : "Save"}</button>
          <button type="button" className="btn small" onClick={() => (setAdding(false), setKey(""), setError(""))}>
            Cancel
          </button>
        </form>
      )}
      {signIn && <SignInPanel key={signIn.id} signIn={signIn} onClose={() => setSignIn(null)} onDifferentAccount={() => void startSignIn(true)} />}
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="muted small" role="status">{note}</p>}
    </li>
  );
}

/**
 * A sign-in in progress. It runs on the server, which listens for the provider's redirect on its own
 * 127.0.0.1. In a browser on that computer the redirect completes it; on another device the redirect
 * page fails to load, so the user pastes its address here instead.
 */
function SignInPanel({ signIn: initial, onClose, onDifferentAccount }: { signIn: SignIn; onClose(): void; onDifferentAccount(): void }) {
  const [signIn, setSignIn] = useState(initial);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () =>
      socket.on((m) => {
        if (m.type === "models.signIn" && m.signIn.id === initial.id) setSignIn(m.signIn);
      }),
    [initial.id],
  );
  useEffect(() => {
    if (signIn.state === "done" || signIn.state === "cancelled") onClose();
  }, [signIn.state, onClose]);

  const paste = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.submitSignInCode(signIn.id, code);
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (signIn.state === "failed")
    return (
      <div className="provider-form column" role="alert">
        <p className="error">Sign-in failed: {signIn.error}</p>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
    );

  return (
    <div className="provider-form column">
      {signIn.authUrl ? (
        <p>
          <a className="btn small primary" href={signIn.authUrl} target="_blank" rel="noreferrer">
            Open the sign-in page
          </a>
        </p>
      ) : (
        <p className="muted">Starting sign-in…</p>
      )}
      {signIn.sameAccount && (
        <p className="muted small">
          Signs in to the ChatGPT account you used before.{" "}
          <button type="button" className="link" onClick={onDifferentAccount}>
            Use a different account
          </button>
        </p>
      )}
      <form onSubmit={(e) => void paste(e)} className="provider-paste">
        <label htmlFor={`paste-${signIn.id}`} className="muted small">
          Signing in on another device? When you're done, the page you land on won't load. Paste its address here.
        </label>
        <div className="provider-form">
          <input
            id={`paste-${signIn.id}`}
            className="input"
            placeholder="Address of the page you landed on"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn small" disabled={!code.trim()}>Continue</button>
          <button type="button" className="btn small" onClick={() => void api.cancelSignIn(signIn.id).catch(() => onClose())}>
            Cancel
          </button>
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
