import { useEffect, useState } from "react";
import { IconDeviceDesktop as Desktop, IconMoon as Moon, IconSun as Sun } from "@tabler/icons-react";
import type { ServerInfo } from "@rails/shared";
import { api } from "../../api.ts";
import { useAppearance, type Appearance } from "../../theme.ts";
import { Segmented } from "../ui/Segmented.tsx";

const THEMES: { value: Appearance; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun size={15} aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon size={15} aria-hidden /> },
  { value: "system", label: "System", icon: <Desktop size={15} aria-hidden /> },
];

/** Settings → General: this browser's appearance, then facts about the Rails server it talks to (read-only). */
export function GeneralSettings() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState("");
  const [appearance, setAppearance] = useAppearance();
  useEffect(() => {
    api.server().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <section className="set-group" aria-labelledby="appearance-title">
        <h3 id="appearance-title">Appearance</h3>
        <div className="set-row" id="setting-appearance" data-settings-row tabIndex={-1}>
          <div className="set-text">
            <span className="set-label" id="appearance-label">Theme</span>
            <p id="appearance-help">System follows this device. Each browser keeps its own choice.</p>
          </div>
          <Segmented name="appearance" value={appearance} options={THEMES} onChange={setAppearance} aria-labelledby="appearance-label" aria-describedby="appearance-help" />
        </div>
      </section>
      {info ? <ServerFacts info={info} /> : error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

function ServerFacts({ info }: { info: ServerInfo }) {
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
