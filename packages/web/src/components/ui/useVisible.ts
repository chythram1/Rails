import { useSyncExternalStore } from "react";

function subscribe(l: () => void) {
  document.addEventListener("visibilitychange", l);
  return () => document.removeEventListener("visibilitychange", l);
}

/** Whether the page is showing (not a background tab or a minimized window): what's on it is being seen. */
export function useVisible(): boolean {
  return useSyncExternalStore(subscribe, () => document.visibilityState === "visible");
}
