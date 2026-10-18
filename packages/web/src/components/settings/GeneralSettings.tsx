import { useEffect, useState } from "react";
import type { ServerInfo } from "@rails/shared";
import { api } from "../../api.ts";

/** Settings → General: facts about the Rails server this browser talks to. Read-only. */
export function GeneralSettings() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.server().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  if (!info) return error ? <p className="error" role="alert">{error}</p> : null;
  return (
    <section className="set-group" aria-labelledby="about-title">
      <h3 id="about-title">About this server</h3>
      <dl className="set-facts">
        <div className="set-row" id="setting-reachable" data-settings-row tabIndex={-1}>
          <dt>Reachable from</dt>
          <dd>
            {info.network ? "Other devices too (LAN, Tailscale)" : "This computer only"}
            <span className="set-sub">
              {info.network ? `Listening on ${info.host}:${info.port}` : `Set RAILS_HOST=0.0.0.0 to use Rails from other devices.`}
            </span>
          </dd>
        </div>
        <div className="set-row" id="setting-browser-address" data-settings-row tabIndex={-1}>
          <dt>This browser uses</dt>
          <dd className="mono">{location.host}</dd>
        </div>
        <div className="set-row" id="setting-version" data-settings-row tabIndex={-1}>
          <dt>Version</dt>
          <dd className="mono">{info.build ?? "Unknown"}</dd>
        </div>
        <div className="set-row" id="setting-tmux" data-settings-row tabIndex={-1}>
          <dt>tmux</dt>
          <dd className="mono">{info.tmux ?? "Not installed"}</dd>
        </div>
        <div className="set-row" id="setting-node" data-settings-row tabIndex={-1}>
          <dt>Node.js</dt>
          <dd className="mono">{info.node}</dd>
        </div>
      </dl>
    </section>
  );
}
