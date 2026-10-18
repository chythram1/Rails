import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconCheck as Check, IconChevronDown as ChevronDown } from "@tabler/icons-react";
import { usePopover } from "./Menu.tsx";

export interface DropdownOption {
  value: string;
  label: string;
  /** Options with a group are listed under its name (e.g. a model's provider). */
  group?: string;
}

/** Long lists get a search field. */
const SEARCH_FROM = 10;

/**
 * A select in the app's own style (ref/sprockets/stage2/dropdown.png shows the browser's, which doesn't
 * fit): a field-like button that opens a list in the popover menus use (usePopover), with a check on the
 * chosen option. Arrow keys move, Enter picks, Escape closes; long lists can be searched. Label it with a
 * <label htmlFor={id}>, as a native select.
 */
export function Dropdown({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder = "Choose…",
}: {
  id?: string;
  value: string;
  options: DropdownOption[];
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { at, trigger, panel, close, toggle } = usePopover("left");
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  const searchable = options.length >= SEARCH_FROM;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.group?.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const optionButtons = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];

  // On open: start at the chosen option (scrolled into view), or in the search field of a long list.
  useEffect(() => {
    if (!at) return setQuery("");
    const current = optionButtons().find((b) => b.getAttribute("aria-selected") === "true");
    current?.scrollIntoView({ block: "center" });
    if (searchable) panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    else (current ?? optionButtons()[0])?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!at]);

  const pick = (o: DropdownOption) => {
    close(true);
    if (o.value !== value) onChange(o.value);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault(); // inside a dialog, close the list rather than the dialog
      e.stopPropagation();
      return close(true);
    }
    if (e.key === "Tab") return close(false);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const buttons = optionButtons();
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return buttons[step > 0 ? 0 : buttons.length - 1]?.focus();
    if (i + step < 0 && searchable) return panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    buttons[Math.max(0, Math.min(buttons.length - 1, i + step))]?.focus();
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="dropdown"
        aria-haspopup="listbox"
        aria-expanded={!!at}
        disabled={disabled}
        onClick={toggle}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !at) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className={"truncate" + (selected ? "" : " muted")}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {at && (
        <div className="menu dropdown-menu" ref={panel} style={{ ...at, width: trigger.current?.offsetWidth }} onKeyDown={onKey}>
          {searchable && (
            <input
              className="dropdown-search"
              placeholder="Search"
              aria-label="Search the options"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && shown[0] && pick(shown[0])}
            />
          )}
          <div className="dropdown-list" role="listbox" ref={list} aria-labelledby={id}>
            {shown.map((o) => {
              const heading = o.group && o.group !== lastGroup ? o.group : undefined;
              lastGroup = o.group;
              return (
                <div key={o.value} role="presentation">
                  {heading && <div className="menu-heading">{heading}</div>}
                  <button type="button" role="option" aria-selected={o.value === value} className={o.value === value ? "active" : undefined} onClick={() => pick(o)}>
                    <span className="truncate">{o.label}</span>
                    {o.value === value && <Check size={15} className="dropdown-check" aria-hidden />}
                  </button>
                </div>
              );
            })}
            {!shown.length && <p className="menu-empty">Nothing matches “{query.trim()}”.</p>}
          </div>
        </div>
      )}
    </>
  );
}
