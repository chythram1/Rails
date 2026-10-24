import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  IconChevronLeft as ChevronLeft,
  IconChevronRight as ChevronRight,
  IconFile as File,
  IconFolder as Folder,
  IconFolderOpen as FolderOpen,
  IconRefresh as RefreshCw,
} from "@tabler/icons-react";
import type { FileEntry, FolderListing, GitState } from "@rails/shared";
import { api } from "../../api.ts";
import { diffLineClass } from "./GitPanel.tsx";

/** How often the tree looks again while it's shown, so agents' edits show up. */
const POLL_MS = 5000;

/** Each state's mark at a file's right (a folder gets a dot), its colour class, and what screen readers hear. */
const MARK: Record<GitState, { letter: string; tone: "new" | "mod" | "del"; said: string }> = {
  modified: { letter: "M", tone: "mod", said: "modified" },
  renamed: { letter: "R", tone: "mod", said: "renamed" },
  added: { letter: "A", tone: "new", said: "added" },
  untracked: { letter: "U", tone: "new", said: "new, not in git yet" },
  deleted: { letter: "D", tone: "del", said: "deleted" },
  conflict: { letter: "!", tone: "del", said: "in conflict" },
};

/** What stays open per project while the side panel switches tabs. */
const memory = new Map<string, { open: string[]; file: string | null }>();

type Row = { entry: FileEntry; depth: number; parent: string };

/**
 * The side panel's Files tab (SidePanel.tsx): the project's files as a tree, one folder loaded as it's opened.
 * Changed files are tinted with a letter for their git state, folders holding changes with a dot, and what git
 * ignores is muted; deleted files stay listed, struck through, until they're committed. It looks again every few
 * seconds while it's shown. A file opens in place of the tree, read-only, with its changes a click away (a deleted
 * file's changes only). Keyboard: the tree pattern (arrows, Home/End, Enter).
 */
export function FilesPanel({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const kept = memory.get(projectId);
  const [folders, setFolders] = useState<Map<string, FolderListing>>(new Map());
  const [open, setOpen] = useState<Set<string>>(() => new Set(kept?.open ?? []));
  const [file, setFile] = useState<string | null>(kept?.file ?? null);
  const [focus, setFocus] = useState<string>("");
  const [error, setError] = useState("");
  const tree = useRef<HTMLUListElement>(null);
  const moved = useRef(false); // the keyboard moved the focus: follow it with the DOM's
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => void memory.set(projectId, { open: [...open], file }), [projectId, open, file]);

  const load = useCallback(
    (dir: string) =>
      api.files(projectId, dir).then(
        (listing) => {
          setFolders((m) => new Map(m).set(dir, listing));
          if (!dir) setError("");
        },
        (e: Error) => {
          if (!dir) return setError(e.message);
          // An open folder that's gone (deleted, renamed): close it.
          setOpen((o) => new Set([...o].filter((p) => p !== dir && !p.startsWith(`${dir}/`))));
        },
      ),
    [projectId],
  );
  const refresh = useCallback(() => {
    for (const dir of ["", ...openRef.current]) void load(dir);
  }, [load]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, refreshKey]);

  const toggle = (dir: string) => {
    const next = new Set(open);
    if (next.has(dir)) next.delete(dir);
    else {
      next.add(dir);
      if (!folders.has(dir)) void load(dir);
    }
    setOpen(next);
  };

  // The rows shown: each open folder's entries under it.
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const listing = folders.get(dir);
    for (const entry of listing?.entries ?? []) {
      rows.push({ entry, depth, parent: dir });
      if (entry.dir && open.has(entry.path)) walk(entry.path, depth + 1);
    }
    // Deleted files are gone from the disk; git still has them, so they're listed after the rest, struck through.
    for (const path of listing?.deleted ?? []) rows.push({ entry: { name: path.slice(path.lastIndexOf("/") + 1), path, dir: false, git: "deleted" }, depth, parent: dir });
  };
  walk("", 0);
  const current = rows.some((r) => r.entry.path === focus) ? focus : rows[0]?.entry.path;

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    tree.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(current ?? "")}"]`)?.focus();
  });

  const activate = (r: Row) => (r.entry.dir ? toggle(r.entry.path) : setFile(r.entry.path));
  const onKey = (e: KeyboardEvent) => {
    const i = rows.findIndex((r) => r.entry.path === current);
    const r = rows[i];
    if (!r) return;
    const go = (to: Row | undefined) => {
      if (!to) return;
      moved.current = true;
      setFocus(to.entry.path);
    };
    const handled = () => e.preventDefault();
    switch (e.key) {
      case "ArrowDown":
        handled();
        return go(rows[i + 1]);
      case "ArrowUp":
        handled();
        return go(rows[i - 1]);
      case "Home":
        handled();
        return go(rows[0]);
      case "End":
        handled();
        return go(rows.at(-1));
      case "ArrowRight":
        handled();
        if (!r.entry.dir) return;
        if (!open.has(r.entry.path)) return toggle(r.entry.path);
        return go(rows[i + 1]?.parent === r.entry.path ? rows[i + 1] : undefined);
      case "ArrowLeft":
        handled();
        if (r.entry.dir && open.has(r.entry.path)) return toggle(r.entry.path);
        return go(rows.find((x) => x.entry.path === r.parent));
      case "Enter":
      case " ":
        handled();
        return activate(r);
    }
  };

  if (file) {
    const state = gitStateOf(folders, file);
    return <FileView projectId={projectId} path={file} state={state} refreshKey={refreshKey} onBack={() => ((moved.current = true), setFocus(file), setFile(null))} />;
  }

  const root = folders.get("");
  return (
    <>
      <div className="side-bar side-git-bar">
        <span className="muted small truncate">{root && !root.isRepo ? "Not a git repository: no changes to show" : ""}</span>
        <span className="grow" />
        <button className="icon-btn" aria-label="Refresh the files" title="Refresh" onClick={refresh}>
          <RefreshCw size={16} />
        </button>
      </div>
      {error && !root ? (
        <div className="pad">
          <p className="error small" role="alert">{error}</p>
          <button className="btn small" onClick={refresh}>Try again</button>
        </div>
      ) : !root ? (
        <p className="muted small pad">Loading…</p>
      ) : !rows.length ? (
        <p className="muted small pad">This folder is empty.</p>
      ) : (
        <ul ref={tree} className="file-tree" role="tree" aria-label="Files" onKeyDown={onKey}>
          {rows.map((r) => {
            const { entry } = r;
            const mark = entry.git && MARK[entry.git];
            const expanded = entry.dir ? open.has(entry.path) : undefined;
            return (
              <li
                key={entry.path}
                data-path={entry.path}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={expanded}
                tabIndex={entry.path === current ? 0 : -1}
                className={"file-row" + (mark ? ` t-${mark.tone}` : "") + (entry.ignored ? " ignored" : "")}
                style={{ "--depth": r.depth } as CSSProperties}
                title={entry.path}
                onClick={() => {
                  setFocus(entry.path);
                  activate(r);
                }}
              >
                {entry.dir ? <ChevronRight size={14} className="file-chev" aria-hidden /> : <span className="file-chev" aria-hidden />}
                {entry.dir ? expanded ? <FolderOpen size={16} className="file-icon" aria-hidden /> : <Folder size={16} className="file-icon" aria-hidden /> : <File size={16} className="file-icon" aria-hidden />}
                <span className="file-name truncate">{entry.name}</span>
                {mark && (entry.dir ? <span className="file-dot" aria-hidden /> : <span className="file-mark" aria-hidden>{mark.letter}</span>)}
                {(mark || entry.ignored) && (
                  <span className="sr-only">
                    {mark ? `, ${entry.dir ? `holds changes (${mark.said})` : mark.said}` : ""}
                    {entry.ignored ? ", ignored by git" : ""}
                  </span>
                )}
              </li>
            );
          })}
          {[...folders.values()].some((f) => f.more) && <li className="muted small pad" role="none">Some folders hold more than the tree shows.</li>}
        </ul>
      )}
    </>
  );
}

/** A file's state, from its folder's listing. */
function gitStateOf(folders: Map<string, FolderListing>, path: string): GitState | undefined {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const listing = folders.get(dir);
  return listing?.deleted.includes(path) ? "deleted" : listing?.entries.find((e) => e.path === path)?.git;
}

/** A file in place of the tree: its text (read-only, with line numbers), or its changes when it has some. */
function FileView({ projectId, path, state, refreshKey, onBack }: { projectId: string; path: string; state?: GitState; refreshKey: string; onBack(): void }) {
  const [view, setView] = useState<"file" | "changes">(state === "deleted" ? "changes" : "file");
  const [text, setText] = useState<{ text: string; cut: boolean } | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);

  useEffect(() => {
    let current = true; // a slower answer for an earlier view mustn't replace this one
    setError("");
    if (view === "file")
      api.fileText(projectId, path).then(
        (t) => current && setText(t),
        (e: Error) => current && setError(e.message),
      );
    else
      api.diff(projectId, path).then(
        (d) => current && setDiff(d),
        (e: Error) => current && setError(e.message),
      );
    return () => void (current = false);
  }, [projectId, path, view, refreshKey, tick]);

  const changed = !!state && state !== "deleted";
  return (
    <div className="file-view">
      <div className="side-bar">
        <button ref={back} className="icon-btn" aria-label="Back to the files" title="Back" onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        <span className="file-path truncate" title={path}>{path}</span>
        <span className="grow" />
        {changed && (
          <div className="file-views" role="group" aria-label="Show">
            <button type="button" className="file-view-btn" aria-pressed={view === "file"} onClick={() => setView("file")}>File</button>
            <button type="button" className="file-view-btn" aria-pressed={view === "changes"} onClick={() => setView("changes")}>Changes</button>
          </div>
        )}
        <button className="icon-btn" aria-label="Reload the file" title="Reload" onClick={() => setTick((t) => t + 1)}>
          <RefreshCw size={16} />
        </button>
      </div>
      {error ? (
        <p className="muted small pad" role="alert">{error}</p>
      ) : view === "changes" ? (
        diff === null ? (
          <p className="muted small pad">Loading…</p>
        ) : (
          <pre className="diff" aria-label={`Changes to ${path}`}>
            {diff ? diff.split("\n").map((l, i) => <div key={i} className={diffLineClass(l)}>{l || " "}</div>) : "No changes."}
          </pre>
        )
      ) : !text ? (
        <p className="muted small pad">Loading…</p>
      ) : (
        <div className="file-body">
          <pre className="file-text" aria-label={`The text of ${path}`}>
            {(text.text.endsWith("\n") ? text.text.slice(0, -1) : text.text).split("\n").map((l, i) => (
              <div key={i}>{l || " "}</div>
            ))}
          </pre>
          {text.cut && <p className="muted small pad">That's the first 256 KB of it.</p>}
        </div>
      )}
    </div>
  );
}
