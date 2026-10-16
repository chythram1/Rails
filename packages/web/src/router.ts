import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  /** A project's workspace. `openKey` asks it to open (or focus) that session's panel. */
  | { name: "workspace"; projectId: string; openKey?: string }
  | { name: "customize" }
  | { name: "automate" };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "p" && parts[1] && parts[2] === "s" && parts[3]) return { name: "workspace", projectId: parts[1], openKey: parts[3] };
  if (parts[0] === "p" && parts[1]) return { name: "workspace", projectId: parts[1] };
  if (parts[0] === "customize") return { name: "customize" };
  if (parts[0] === "automate") return { name: "automate" };
  return { name: "home" };
}

export const href = {
  home: () => "#/",
  project: (projectId: string) => `#/p/${encodeURIComponent(projectId)}`,
  session: (projectId: string, key: string) => `#/p/${encodeURIComponent(projectId)}/s/${encodeURIComponent(key)}`,
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
