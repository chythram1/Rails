import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RecentFolder } from "@rails/shared";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { usePopover } from "./Menu.tsx";

// Last list from the server, so the menu shows folders instantly while it refreshes. Prefetched when the
// pointer reaches the trigger, so even the first open isn't empty.
let cache: RecentFolder[] = [];
/** Rows shown at once (recent or search matches), so the menu never needs a scrollbar. */
const MAX_ROWS = 8;
const prefetch = () => void api.recentFolders().then((f) => (cache = f), () => {});

interface Props {
  /** Accessible name of the trigger button. */
  label: string;
  className?: string;
  align?: "left" | "right";
  children: ReactNode;
}

/**
 * The "add project" menu (ref/new-project.png): filter recent agent folders that aren't projects yet by
 * name and pick one to add it, or use "Open folder…" for the native folder picker. Shows folder names,
 * never paths.
 */
export function FolderMenu({ label, className, align = "left", children }: Props) {
  const { picking, openFolder, chooseFolder } = useStore();
  const { at, trigger, panel, close, toggle } = usePopover(align);
  const [folders, setFolders] = useState(cache);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!at) return;
    setQuery("");
    setActive(0);
    setFolders(cache);
    void api.recentFolders().then((f) => setFolders((cache = f)), () => {});
  }, [at]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders).slice(0, MAX_ROWS);
  }, [folders, query]);

  // Folders that share a name get their parent folder's name as a hint (still no full path).
  const hint = useMemo(() => {
    const count = new Map<string, number>();
    for (const f of folders) count.set(f.name, (count.get(f.name) ?? 0) + 1);
    return (f: RecentFolder) => (count.get(f.name)! > 1 ? f.path.split("/").slice(-2, -1)[0] : undefined);
  }, [folders]);

  // Rows: the shown folders, then "Open folder…".
  const rows = shown.length + 1;
  const pick = (i: number) => {
    close(false);
    if (i < shown.length) void chooseFolder(shown[i].path);
    else void openFolder();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return close(true);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : rows - 1)) % rows);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(Math.min(active, rows - 1));
    }
  };

  return (
    <>
      <button
        ref={trigger}
        className={className}
        aria-label={label}
        title={picking ? "Choose a folder in the window that opened" : label}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        disabled={picking}
        onPointerEnter={prefetch}
        onClick={toggle}
      >
        {children}
      </button>
      {at && (
        <div className="menu folder-menu" role="dialog" aria-label={label} ref={panel} style={at}>
          <input
            className="folder-search"
            autoFocus
            placeholder="Search folders…"
            aria-label="Search folders"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <div className="menu-sep" />
          <div className="folder-list" role="listbox" aria-label="Recent folders">
            {!query && shown.length > 0 && <div className="menu-heading">Recent</div>}
            {shown.map((f, i) => (
              <button
                key={f.path}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                tabIndex={-1}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="truncate">{f.name}</span>
                {hint(f) && <span className="muted small truncate">{hint(f)}</span>}
              </button>
            ))}
            {query && shown.length === 0 && <div className="menu-empty">No matching folders</div>}
          </div>
          <div className="menu-sep" />
          <button className={active === shown.length ? "active" : undefined} tabIndex={-1} onMouseMove={() => setActive(shown.length)} onClick={() => pick(shown.length)}>
            Open folder…
          </button>
        </div>
      )}
    </>
  );
}
