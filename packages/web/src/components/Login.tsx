import { useState } from "react";
import { api } from "../api.ts";

export function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.login(token.trim());
      onDone();
    } catch {
      setError("That token didn't work. Check the server log or ~/.rails/config.json.");
    }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>rails</h1>
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
