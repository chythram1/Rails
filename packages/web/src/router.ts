import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  /** A project's workspace. `openKey` asks it to open (or focus) that session's panel. */
  | { name: "workspace"; projectId: string; openKey?: string }
  /** Sprockets (ADR 0005): the list, the creator (`new`, `edit`), one Sprocket's chat or its settings. */
  | { name: "sprockets"; view: "list" | "new" | "chat" | "edit" | "settings"; id?: string }
  | { name: "customize" }
  | { name: "automate" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "p" && parts[1] && parts[2] === "s" && parts[3]) return { name: "workspace", projectId: parts[1], openKey: parts[3] };
  if (parts[0] === "p" && parts[1]) return { name: "workspace", projectId: parts[1] };
  if (parts[0] === "sprockets") {
    if (parts[1] === "new") return { name: "sprockets", view: "new" };
    if (parts[1] && parts[2] === "edit") return { name: "sprockets", view: "edit", id: parts[1] };
    if (parts[1] && parts[2] === "settings") return { name: "sprockets", view: "settings", id: parts[1] };
    if (parts[1]) return { name: "sprockets", view: "chat", id: parts[1] };
    return { name: "sprockets", view: "list" };
  }
  if (parts[0] === "customize") return { name: "customize" };
  if (parts[0] === "automate") return { name: "automate" };
  return { name: "home" };
}

export const href = {
  home: () => "#/",
  project: (projectId: string) => `#/p/${encodeURIComponent(projectId)}`,
  session: (projectId: string, key: string) => `#/p/${encodeURIComponent(projectId)}/s/${encodeURIComponent(key)}`,
  sprockets: () => "#/sprockets",
  newSprocket: () => "#/sprockets/new",
  sprocket: (id: string) => `#/sprockets/${encodeURIComponent(id)}`,
  editSprocket: (id: string) => `#/sprockets/${encodeURIComponent(id)}/edit`,
  sprocketSettings: (id: string) => `#/sprockets/${encodeURIComponent(id)}/settings`,
  customize: () => "#/customize",
};

export function navigate(to: string) {
  location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
