import { useEffect, useState } from "react";
import { api, Unauthorized } from "./api.ts";
import { Home } from "./components/Home.tsx";
import { Login } from "./components/Login.tsx";
import { ModelsSettings } from "./components/ModelsSettings.tsx";
import { Placeholder } from "./components/Placeholder.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { SprocketsPage } from "./components/sprockets/SprocketsPage.tsx";
import { Workspace } from "./components/Workspace.tsx";
import { useRoute } from "./router.ts";
import { StoreProvider } from "./store.tsx";

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
          <h1>rails</h1>
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

  return (
    <div className={"shell" + (navOpen ? " nav-open" : "")}>
      <Sidebar route={route} />
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <button className="icon-btn nav-toggle" aria-label="Open sidebar" onClick={() => setNavOpen(true)}>
          <span aria-hidden>☰</span>
        </button>
        {route.name === "home" && <Home />}
        {route.name === "workspace" && <Workspace key={route.projectId} projectId={route.projectId} openKey={route.openKey} />}
        {route.name === "sprockets" && <SprocketsPage route={route} />}
        {route.name === "customize" && (
          <div className="page settings">
            <h1 className="page-title">Customize</h1>
            <ModelsSettings />
          </div>
        )}
        {route.name === "automate" && <Placeholder title="Automate" body="Scheduled and triggered agent runs will live here." />}
      </main>
    </div>
  );
}
