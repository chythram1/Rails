import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  IconCpu as Cpu,
  IconPlugConnected as Plug,
  IconSearch as Search,
  IconServer2 as Server,
  IconUserCircle as UserCircle,
  IconX as X,
} from "@tabler/icons-react";
import { useModelSettings } from "../ModelSelect.tsx";
import { AccountSettings } from "./AccountSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { ModelsSettings } from "./ModelsSettings.tsx";
import { ProvidersSettings } from "./ProvidersSettings.tsx";
import { providerEntries, searchSettings, SECTION_LABELS, SETTINGS, type SettingEntry, type SettingsSection } from "./search.ts";


const SECTIONS: { id: SettingsSection; icon: ReactNode; body: () => ReactNode }[] = [
  { id: "general", icon: <Server size={17} />, body: () => <GeneralSettings /> },
  { id: "providers", icon: <Plug size={17} />, body: () => <ProvidersSettings /> },
  { id: "models", icon: <Cpu size={17} />, body: () => <ModelsSettings /> },
  { id: "account", icon: <UserCircle size={17} />, body: () => <AccountSettings /> },
];

/**
 * Settings, as a modal over the current page: the close button, a search field and
 * the sections on the left, the chosen section's title and groups of rows on the right. A native <dialog> traps focus,
 * makes the page behind it inert and closes on Escape. Typing in the search field swaps the sections for
 * matching settings (search.ts); picking one opens its section and takes focus to that row. On small
 * screens the dialog fills the screen and the sections become a row of tabs.
 */
export function SettingsDialog({ section, onSection, onClose }: { section: SettingsSection; onSection(s: SettingsSection): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  /** The row a search result asked for; `n` makes picking the same row again count. */
  const [target, setTarget] = useState<{ rowId: string; n: number } | null>(null);
  const { settings: models } = useModelSettings();

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    document.getElementById("settings-search")?.focus(); // the close button comes first, but search is what's wanted
    return () => d.close();
  }, []);

  // A link elsewhere in Settings that opens another section ("Connect a provider") disappears with its page;
  // give focus to the section's tab rather than losing it to the page behind.
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) tabs.current?.querySelector<HTMLElement>(`#settings-tab-${section}`)?.focus();
  }, [section]);

  const found = useMemo(() => searchSettings(query, [...SETTINGS, ...providerEntries(models?.providers ?? [])]), [query, models]);

  // Go to a picked row once its section is showing (the DOM is there when this runs). Rows that load
  // later (providers) are retried for a moment. Timers, not animation frames, which pause in hidden tabs.
  useEffect(() => {
    if (!target) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const go = () => {
      const row = document.getElementById(`setting-${target.rowId}`);
      if (!row) return void (++tries < 40 && (timer = setTimeout(go, 50)));
      row.scrollIntoView({ block: "center" });
      row.classList.add("found"); // a static mark (no animation), cleared shortly after
      setTimeout(() => row.classList.remove("found"), 1600);
      // Its control, or the row itself when the control is disabled (every row has tabIndex -1).
      const control = row.querySelector<HTMLElement>("[data-settings-control], select:not(:disabled), input:not(:disabled), button:not(:disabled), a[href]");
      (control ?? row).focus({ preventScroll: true });
    };
    go();
    return () => clearTimeout(timer);
  }, [target]);

  const pick = (e: SettingEntry) => {
    onSection(e.section);
    setTarget((t) => ({ rowId: e.rowId, n: (t?.n ?? 0) + 1 }));
  };

  // Arrow keys move between sections (a vertical tab list, or a row of tabs on small screens).
  const onTabKey = (e: KeyboardEvent) => {
    const next = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!next) return;
    e.preventDefault();
    const i = SECTIONS.findIndex((s) => s.id === section);
    const to = SECTIONS[(i + next + SECTIONS.length) % SECTIONS.length];
    onSection(to.id);
    tabs.current?.querySelector<HTMLButtonElement>(`#settings-tab-${to.id}`)?.focus();
  };

  const resultButtons = () => [...(results.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && query) {
      e.preventDefault(); // clears the search instead of closing the dialog
      setQuery("");
    } else if (e.key === "ArrowDown" && found.length) {
      e.preventDefault();
      resultButtons()[0]?.focus();
    } else if (e.key === "Enter" && found[0]) {
      e.preventDefault();
      pick(found[0]);
    }
  };
  const onResultKey = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const list = resultButtons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement) + step;
    if (i < 0) document.getElementById("settings-search")?.focus();
    else list[Math.min(i, list.length - 1)]?.focus();
  };

  const searching = query.trim() !== "";
  const current = SECTIONS.find((s) => s.id === section)!;
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      aria-label="Settings"
      // Escape: let React own the open state rather than the browser closing the dialog.
      onCancel={(e) => (e.preventDefault(), onClose())}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <nav className="settings-nav">
        <div className="settings-head">
          <button className="icon-btn settings-close" aria-label="Close settings" title="Close (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
          <p id="settings-nav-title" className="eyebrow">Settings</p>
        </div>
        <label className="settings-search">
          <Search size={16} aria-hidden />
          <input
            id="settings-search"
            type="search"
            placeholder="Search"
            aria-label="Search settings"
            aria-controls={searching ? "settings-results" : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
        <p className="sr-only" role="status">
          {searching ? `${found.length} ${found.length === 1 ? "setting" : "settings"} found` : ""}
        </p>
        {searching &&
          (found.length ? (
            <ul id="settings-results" ref={results} className="settings-results" aria-label="Matching settings" onKeyDown={onResultKey}>
              {found.map((e) => (
                <li key={e.rowId}>
                  <button className="settings-result" onClick={() => pick(e)}>
                    <span>{e.label}</span>
                    <span className="muted small">{SECTION_LABELS[e.section]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-empty muted small">No settings match “{query.trim()}”.</p>
          ))}
        {/* Kept in the page while searching (hidden), since the panel is labelled by its tab. */}
        <div className="settings-sections" hidden={searching}>
          <div ref={tabs} role="tablist" aria-orientation="vertical" aria-labelledby="settings-nav-title" onKeyDown={onTabKey}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                id={`settings-tab-${s.id}`}
                role="tab"
                aria-selected={s.id === section}
                aria-controls="settings-panel"
                tabIndex={s.id === section ? 0 : -1}
                className="settings-tab"
                onClick={() => onSection(s.id)}
              >
                {s.icon}
                {SECTION_LABELS[s.id]}
              </button>
            ))}
          </div>
        </div>
      </nav>
      <div id="settings-panel" className="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`}>
        <div className="settings-panel-body" key={section}>
          <h2 className="settings-title">{SECTION_LABELS[section]}</h2>
          {current.body()}
        </div>
      </div>
    </dialog>
  );
}
