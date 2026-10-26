import { useEffect, useState } from "react";
import { IconRefresh as RefreshCw } from "@tabler/icons-react";
import type { GitFile, GitStatus, PanelKind } from "@rails/shared";
import { api } from "../../api.ts";
import { shortTitle, timeAgo } from "../../util.ts";
import { Dropdown, type DropdownOption } from "../ui/Dropdown.tsx";
import { PanelIcon } from "./PanelMenu.tsx";

/** How often the list looks again while it's shown, as the Files tab does: sessions change files as you watch. */
const POLL_MS = 5000;

/**
 * The side panel's Git tab (SidePanel.tsx): the branch, the changed files and a file's diff. Each file shows its
 * name, the lines it changed, its folder, and which open sessions changed it (changes.ts on the server). Once a
 * session has changed something, "Show" narrows the list to one session's files, or to those no open session did.
 */
export function GitPanel({ projectId, refreshKey }: { projectId: string; refreshKey: string }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState("all"); // "all", "none", or a session's panel id

  const load = () => {
    setError("");
    api.git(projectId).then(setStatus, (e: Error) => setError(e.message));
  };
  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, refreshKey]);

  // The shown diff follows the file as it changes.
  const chosen = status?.files.find((f) => f.path === file);
  const version = chosen ? `${chosen.added}/${chosen.deleted}/${chosen.editedBy?.[0]?.at}` : "";
  useEffect(() => {
    if (!file) return;
    let current = true; // a slower answer for a file selected earlier mustn't replace this one
    api.diff(projectId, file).then(
      (d) => current && setDiff(d),
      (e: Error) => current && setDiff(e.message),
    );
    return () => void (current = false);
  }, [projectId, file, refreshKey, version]);

  // The sessions that changed something, each once, newest first, for "Show".
  const all = status?.files ?? [];
  const sessions = new Map<string, { kind: PanelKind; title: string; count: number }>();
  for (const f of all) for (const e of f.editedBy ?? []) sessions.set(e.panelId, { kind: e.kind, title: e.title, count: (sessions.get(e.panelId)?.count ?? 0) + 1 });
  const unclaimed = all.filter((f) => !f.editedBy?.length).length;
  const filters: DropdownOption[] = [
    { value: "all", label: `All changes (${all.length})` },
    ...[...sessions].map(([panelId, s]) => ({ value: panelId, label: `${shortTitle(s.title)} (${s.count})`, icon: <PanelIcon kind={s.kind} /> })),
    ...(unclaimed ? [{ value: "none", label: `No open session (${unclaimed})` }] : []),
  ];
  // A session that's gone from the list (its panel closed, its files committed) falls back to all of them.
  const filter = filters.some((o) => o.value === shown) ? shown : "all";
  const files = filter === "all" ? all : all.filter((f) => (filter === "none" ? !f.editedBy?.length : f.editedBy?.some((e) => e.panelId === filter)));
  const pick = (value: string) => {
    setShown(value);
    setFile(null);
  };

  return (
    <>
      <div className="side-bar side-git-bar">
        {status?.branch && (
          <span className="muted small truncate">
            {status.branch}
            {status.ahead ? ` ↑${status.ahead}` : ""}
            {status.behind ? ` ↓${status.behind}` : ""}
          </span>
        )}
        <span className="grow" />
        {sessions.size > 0 && <Dropdown plain label="Show changes by" value={filter} options={filters} onChange={pick} />}
        <button className="icon-btn" aria-label="Refresh git status" title="Refresh" onClick={load}>
          <RefreshCw size={16} />
        </button>
      </div>
      {error && !status ? (
        <div className="pad">
          <p className="error small" role="alert">{error}</p>
          <button className="btn small" onClick={load}>Try again</button>
        </div>
      ) : !status ? (
        <p className="muted small pad">Loading…</p>
      ) : !status.isRepo ? (
        <p className="muted small pad">This project isn't a git repository.</p>
      ) : status.files.length === 0 ? (
        <p className="muted small pad">Working tree clean.</p>
      ) : (
        <ul className={"git-files" + (file ? " with-diff" : "")}>
          {files.map((f) => (
            <li key={f.path}>
              <FileRow file={f} active={file === f.path} onClick={() => setFile(file === f.path ? null : f.path)} />
            </li>
          ))}
        </ul>
      )}
      {file && (
        <pre className="diff" aria-label={`Diff of ${file}`}>
          {diff
            ? diff.split("\n").map((l, i) => (
                <div key={i} className={diffLineClass(l)}>
                  {l || " "}
                </div>
              ))
            : "No diff."}
        </pre>
      )}
    </>
  );
}

/**
 * One changed file: its status code, its name and the lines it changed, its folder, then who changed it: the
 * newest open session (and how many more), or that no open session did (Rails forgets a closed panel's edits).
 */
function FileRow({ file: f, active, onClick }: { file: GitFile; active: boolean; onClick(): void }) {
  const folder = f.path.endsWith("/") ? f.path.slice(0, -1) : f.path;
  const cut = folder.lastIndexOf("/");
  const name = folder.slice(cut + 1) + (f.path.endsWith("/") ? "/" : "");
  const dir = cut > 0 ? folder.slice(0, cut) : "";
  const [newest, ...more] = f.editedBy ?? [];
  return (
    <button className={"git-file" + (active ? " active" : "")} onClick={onClick} title={f.path}>
      <code className={"git-code c-" + codeClass(f.status)}>{f.status.trim() || "·"}</code>
      <span className="git-file-text">
        <span className="git-file-head">
          <span className="git-file-name truncate">{name}</span>
          {f.added !== undefined && (
            <span className="git-counts">
              {f.added > 0 && <span className="c-add">+{f.added}</span>}
              {f.deleted! > 0 && <span className="c-del">−{f.deleted}</span>}
            </span>
          )}
        </span>
        {dir && <span className="git-file-dir truncate">{dir}</span>}
        {newest ? (
          <span className="git-file-by" title={(f.editedBy ?? []).map((e) => `${e.title}, ${timeAgo(e.at)}`).join("\n")}>
            <PanelIcon kind={newest.kind} />
            <span className="truncate">
              {shortTitle(newest.title)}
              {more.length > 0 && ` and ${more.length} more`}
            </span>
            <span className="git-file-when">{timeAgo(newest.at)}</span>
          </span>
        ) : (
          <span className="git-file-by muted">No open session changed it</span>
        )}
      </span>
    </button>
  );
}

/** Colour class for a porcelain XY status code. */
function codeClass(status: string) {
  if (status === "??") return "new";
  if (status.includes("D")) return "del";
  if (status.includes("A")) return "new";
  return "mod";
}

/** Colour class for one line of unified diff output. File headers (+++ / ---) stay uncoloured. */
export function diffLineClass(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return "";
}
