import { useEffect, useRef, useState } from "react";
import type { ServerInfo } from "@rails/shared";
import { api } from "../../api.ts";
import { ProfileSettings } from "./ProfileSettings.tsx";

/**
 * Settings → Account: the profile (ProfileSettings.tsx), then access. Rails has one user and one access
 * token (ADR 0001), so access is that token: sign this browser out, or replace the token to sign out every device (Claude's "Log out of all
 * devices"). This device stays signed in and gets a link for signing the others back in.
 */
export function AccountSettings() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.server().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  const signOut = async () => {
    setError("");
    try {
      await api.logout(); // the app switches to the sign-in screen
    } catch (e: any) {
      setError(e.message);
    }
  };

  const signOutEverywhere = async () => {
    if (!confirm("Sign out everywhere?\n\nRails makes a new access token. Every other device is signed out until it signs in with the new one. This device stays signed in.")) return;
    setError("");
    setBusy(true);
    try {
      const { token } = await api.signOutEverywhere();
      setLink(`${location.origin}/?token=${encodeURIComponent(token)}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ProfileSettings />
      <section className="set-group" aria-labelledby="access-title">
        <h3 id="access-title">Access</h3>
        <div className="set-row" id="setting-sign-out" data-settings-row tabIndex={-1}>
          <div className="set-text">
            <span className="set-label">Sign out on this device</span>
            <p>This browser needs the access token to get back in.</p>
          </div>
          <button className="btn small" onClick={() => void signOut()}>Sign out</button>
        </div>
        <div className="set-row" id="setting-sign-out-everywhere" data-settings-row tabIndex={-1}>
          <div className="set-text">
            <span className="set-label">Sign out everywhere</span>
            <p>
              {info?.tokenFromEnv
                ? "The access token is set with RAILS_TOKEN, so Rails can't replace it. Change it there and restart Rails."
                : "Makes a new access token, so every other device has to sign in again. This one stays signed in."}
            </p>
          </div>
          <button className="btn small danger" disabled={!info || info.tokenFromEnv || busy} onClick={() => void signOutEverywhere()}>
            Sign out everywhere
          </button>
        </div>
        {link && <NewLink link={link} />}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </>
  );
}

/** The sign-in link with the new token. Shown once; `make token` prints the token again later. */
function NewLink({ link }: { link: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  // The async clipboard API needs a secure context, and Rails also runs over plain HTTP on the LAN, so
  // copy the old way: select the text and run the copy command.
  const copy = () => {
    input.current?.select();
    setCopied(document.execCommand("copy"));
  };
  return (
    <div className="set-callout" role="status">
      <p>Every other device is signed out. To sign one back in, open this link on it:</p>
      <div className="provider-form">
        <label htmlFor="new-link" className="sr-only">Sign-in link</label>
        <input id="new-link" ref={input} className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="muted small">Anyone with this link can use Rails. You can also print the token with <code>make token</code>.</p>
    </div>
  );
}
