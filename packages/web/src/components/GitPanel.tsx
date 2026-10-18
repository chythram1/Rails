import { useEffect, useState } from "react";
import { IconRefresh as RefreshCw, IconX as X } from "@tabler/icons-react";
import type { GitStatus } from "@rails/shared";
import { api } from "../api.ts";

export function GitPanel({ projectId, refreshKey, onClose }: { projectId: string; refreshKey: string; onClose(): void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    api.git(projectId).then(setStatus, (e: Error) => setError(e.message));
  };
  useEffect(load, [projectId, refreshKey]);

  useEffect(() => {
    if (!file) return;
    let current = true; // a slower answer for a file selected earlier mustn't replace this one
    api.diff(projectId, file).then(
      (d) => current && setDiff(d),
      (e: Error) => current && setDiff(e.message),
    );
    return () => void (current = false);
  }, [projectId, file, refreshKey]);

  return (
    <aside className="git-panel" aria-label="Git">
      <header className="git-head">
        <strong>Git</strong>
        {status?.branch && (
          <span className="muted small truncate">
            {status.branch}
            {status.ahead ? ` ↑${status.ahead}` : ""}
            {status.behind ? ` ↓${status.behind}` : ""}
          </span>
        )}
        <span className="grow" />
        <button className="icon-btn" aria-label="Refresh" onClick={load}>
          <RefreshCw size={16} />
        </button>
        <button className="icon-btn" aria-label="Close git panel" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
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
        <ul className="git-files">
          {status.files.map((f) => (
            <li key={f.path}>
              <button className={"git-file" + (file === f.path ? " active" : "")} onClick={() => setFile(file === f.path ? null : f.path)}>
                <code className={"git-code c-" + codeClass(f.status)}>{f.status.trim() || "·"}</code>
                <span className="truncate">{f.path}</span>
              </button>
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
    </aside>
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
function diffLineClass(line: string) {
  if (line.startsWith("+++") || line.startsWith("---")) return "";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return "";
}
