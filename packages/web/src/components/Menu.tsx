import { useEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = "separator" | MenuAction;

interface MenuAction {
  label: string;
  icon?: ReactNode;
  /** Single key that picks this item while the menu is open, shown on the right. */
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Muted text after the label, e.g. why an item is disabled. */
  note?: string;
  onSelect(): void;
}

interface Props {
  /** Accessible name of the trigger button. */
  label: string;
  title?: string;
  icon: ReactNode;
  /** Extra class on the trigger (e.g. `reveal` to show it only on row hover). */
  className?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: "left" | "right";
  items: MenuItem[];
}

/**
 * An icon button that opens a menu (see ref/project-menu.png). The menu is fixed-positioned so pane
 * headers and the sidebar can't clip it. Arrow keys move, a shortcut key picks, Escape closes.
 */
export function MenuButton({ label, title, icon, className, align = "left", items }: Props) {
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setAt(null);
    if (refocus) trigger.current?.focus();
  };

  const pick = (item: MenuAction) => {
    if (item.disabled) return;
    close(false);
    item.onSelect();
  };

  useEffect(() => {
    if (!at) return;
    const buttons = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    buttons()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close(true);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const list = buttons();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const actions = items.filter((it): it is MenuAction => it !== "separator");
      const hit = actions.find((it) => it.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        pick(hit);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, items]);

  const toggle = () => {
    if (at) return close(false);
    const r = trigger.current!.getBoundingClientRect();
    setAt(align === "right" ? { top: r.bottom + 6, right: innerWidth - r.right } : { top: r.bottom + 6, left: Math.min(r.left, innerWidth - 240) });
  };

  return (
    <>
      <button
        ref={trigger}
        className={"icon-btn" + (className ? " " + className : "")}
        aria-label={label}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={toggle}
      >
        {icon}
      </button>
      {at && (
        <div className="menu" role="menu" ref={menu} style={at}>
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={i} className="menu-sep" role="separator" />
            ) : (
              <button key={item.label} role="menuitem" className={item.danger ? "danger" : undefined} disabled={item.disabled} onClick={() => pick(item)}>
                {item.icon}
                <span>{item.label}</span>
                {item.note && <span className="muted small">{item.note}</span>}
                {item.shortcut && <kbd className="menu-key">{item.shortcut.toUpperCase()}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
