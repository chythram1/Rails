import { useEffect, useState } from "react";

/**
 * Appearance: the user's choice, kept per browser (each device can differ), and the theme it resolves to.
 * System follows the OS, live. index.html applies the same choice before the first paint (keep the key and
 * the resolution there in step with this file), so a light page never flashes dark.
 */
export type Appearance = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "rails.appearance";
const DARK = "(prefers-color-scheme: dark)";
/** The browser's own bar (phones): each theme's canvas, `--bg` in styles.css. */
const BAR: Record<Theme, string> = { light: "#ffffff", dark: "#1d1d1d" };

export const resolveTheme = (appearance: Appearance, osDark: boolean): Theme =>
  appearance === "system" ? (osDark ? "dark" : "light") : appearance;

function saved(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // storage blocked: follow the OS
  }
  return "system";
}

let chosen: Appearance = "system";
const listeners = new Set<() => void>();

function apply() {
  const theme = resolveTheme(chosen, matchMedia(DARK).matches);
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  for (const l of listeners) l();
}

/** Start following the choice, the OS (while it's System) and other tabs. Once, before the first render. */
export function initTheme() {
  chosen = saved();
  apply();
  matchMedia(DARK).addEventListener("change", apply);
  addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    chosen = saved();
    apply();
  });
}

export function setAppearance(appearance: Appearance) {
  chosen = appearance;
  try {
    if (appearance === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, appearance);
  } catch {
    // not saved: this page still switches
  }
  apply();
}

/** The current choice (kept current when another tab changes it) and the way to change it. */
export function useAppearance() {
  const [appearance, set] = useState(chosen);
  useEffect(() => {
    const update = () => set(chosen);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return [appearance, setAppearance] as const;
}
