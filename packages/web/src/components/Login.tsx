import { useState } from "react";
import { api, Unauthorized } from "../api.ts";

export function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.login(token.trim());
      onDone();
    } catch (err) {
      // Only a 401 means the token is wrong; show anything else (server down, cross-origin) as is.
      setError(
        err instanceof Unauthorized
          ? "That token didn't work. Use the one in the server's startup log (make token prints it)."
          : (err as Error).message,
      );
    }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>Rails</h1>
        <p className="muted">Enter the access token printed when the server started.</p>
        <label className="field">
          <span>Access token</span>
          <input autoFocus type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" disabled={!token.trim()}>Sign in</button>
      </form>
    </div>
  );
}
