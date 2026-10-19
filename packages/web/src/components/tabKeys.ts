import type { KeyboardEvent } from "react";

/**
 * Arrow keys, Home and End for a row of tabs (ARIA APG tabs, selection follows focus), on the element with
 * `role="tablist"`: they move focus to the next tab and select it by clicking it. Each tab sets
 * `tabIndex={selected ? 0 : -1}`, so Tab enters the row once, at the selected tab. Settings has its own,
 * vertical version (settings/SettingsDialog.tsx).
 */
export function onTabKeys(e: KeyboardEvent<HTMLElement>): void {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const i = tabs.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const tab = tabs[(to + tabs.length) % tabs.length];
  tab.focus();
  tab.click();
}
