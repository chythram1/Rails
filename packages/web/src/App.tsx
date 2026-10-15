import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { Home } from "./components/Home.tsx";
import { Login } from "./components/Login.tsx";
import { Placeholder } from "./components/Placeholder.tsx";
import { SessionView } from "./components/SessionView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { useRoute } from "./router.ts";
import { StoreProvider } from "./store.tsx";

type Auth = "checking" | "in" | "out";

export function App() {
  const [auth, setAuth] = useState<Auth>("checking");

  useEffect(() => {
    // Accept ?token=... once (printed by the server on startup), then strip it from the URL.
    const url = new URL(location.href);
    const token = url.searchParams.get("token");
    const check = async () => {
      if (token) {
        url.searchParams.delete("token");
        history.replaceState(null, "", url);
        await api.login(token).catch(() => {});
      }
      try {
        await api.me();
        setAuth("in");
      } catch {
        setAuth("out");
      }
    };
    void check();
  }, []);

  if (auth === "checking") return null;
  if (auth === "out") return <Login onDone={() => setAuth("in")} />;
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
        {route.name === "home" && <Home projectId={route.projectId} />}
        {route.name === "session" && <SessionView key={route.key} projectId={route.projectId} sessionKey={route.key} />}
        {route.name === "customize" && <Placeholder title="Customize" body="Agent profiles, models, prompts and tools will live here." />}
        {route.name === "automate" && <Placeholder title="Automate" body="Scheduled and triggered agent runs will live here." />}
      </main>
    </div>
  );
}
