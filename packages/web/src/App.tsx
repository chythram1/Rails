import { useCallback, useEffect, useRef, useState } from "react";
import { api, onSignedOut, Unauthorized } from "./api.ts";
import { CustomizePage } from "./components/customize/CustomizePage.tsx";
import { Notices } from "./components/ConfirmDialog.tsx";
import { Home } from "./components/Home.tsx";
import { Login } from "./components/Login.tsx";
import { AutomatePage } from "./components/automate/AutomatePage.tsx";
import { SettingsContext } from "./components/settings/context.ts";
import { SettingsDialog } from "./components/settings/SettingsDialog.tsx";
import type { SettingsSection } from "./components/settings/search.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { SprocketsPage } from "./components/sprockets/SprocketsPage.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { useRoute } from "./router.ts";
import { StoreProvider } from "./store.tsx";
import { socket } from "./ws.ts";

type Auth = "checking" | "in" | "out" | "down";

export function App() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [downError, setDownError] = useState("");

  // Only a 401 means "sign in"; any other failure (usually the server being down) gets its own screen.
  const check = async () => {
    try {
      await api.me();
      setAuth("in");
    } catch (e: any) {
      setDownError(e.message);
      setAuth(e instanceof Unauthorized ? "out" : "down");
    }
  };

  // Any 401 means this browser was signed out (on purpose, or by "Sign out everywhere" elsewhere).
  useEffect(
    () =>
      onSignedOut(() => {
        socket.disconnect();
        setAuth("out");
      }),
    [],
  );
  // A dropped connection may mean the same: check, and ignore other failures (the server restarting).
  useEffect(() => socket.onConnection((up) => void (up || api.me().catch(() => {}))), []);

  useEffect(() => {
    // Accept ?token=... once (printed by the server on startup), then strip it from the URL.
    const url = new URL(location.href);
    const token = url.searchParams.get("token");
    const start = async () => {
      if (token) {
        url.searchParams.delete("token");
        history.replaceState(null, "", url);
        await api.login(token).catch(() => {});
      }
      await check();
    };
    void start();
  }, []);

  if (auth === "checking") return null;
  if (auth === "out") return <Login onDone={() => setAuth("in")} />;
  if (auth === "down")
    return (
      <div className="login">
        <div className="login-card">
          <h1>Rails</h1>
          <p className="error" role="alert">{downError}</p>
          <button className="btn primary" onClick={() => void check()}>Try again</button>
        </div>
      </div>
    );
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [route]);

  // Settings is a modal over whatever page is open, so it's app state rather than a route.
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const lastSection = useRef<SettingsSection>("general");
  const openSettings = useCallback((section?: SettingsSection) => {
    setNavOpen(false);
    setSettings(section ?? lastSection.current);
  }, []);
  const closeSettings = () => {
    setSettings(null);
    // Opened from the account menu, whose items are gone: give focus back to the account row.
    setTimeout(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLElement>(".account-row")?.focus();
    });
  };

  return (
    <SettingsContext.Provider value={openSettings}>
      <div className={"shell" + (navOpen ? " nav-open" : "")}>
        <Sidebar route={route} />
        <div className="scrim" onClick={() => setNavOpen(false)} />
        <main className="main">
          <button className="icon-btn nav-toggle" aria-label="Open sidebar" onClick={() => setNavOpen(true)}>
            <span aria-hidden>☰</span>
          </button>
          {route.name === "home" && <Home promptId={route.promptId} />}
          {route.name === "workspace" && <Workspace key={route.projectId} projectId={route.projectId} openKey={route.openKey} />}
          {route.name === "sprockets" && <SprocketsPage route={route} />}
          {route.name === "customize" && <CustomizePage route={route} />}
          {route.name === "automate" && <AutomatePage route={route} />}
        </main>
        {settings && (
          <SettingsDialog
            section={settings}
            onSection={(s) => setSettings((lastSection.current = s))}
            onClose={closeSettings}
          />
        )}
        <Notices />
      </div>
    </SettingsContext.Provider>
  );
}
