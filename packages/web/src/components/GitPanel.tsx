import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { GitStatus } from "@rails/shared";
import { api } from "../api.ts";

export function GitPanel({ projectId, refreshKey, onClose }: { projectId: string; refreshKey: string; onClose(): void }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [diff, setDiff] = useState("");

  const load = () => {
    void api.git(projectId).then(setStatus);
  };
  useEffect(load, [projectId, refreshKey]);

  useEffect(() => {
    if (file) void api.diff(projectId, file).then(setDiff);
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
      {!status ? (
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
                <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
                  {l || " "}
                </div>
              ))
            : "No diff."}
        </pre>
      )}
    </aside>
  );
}

const codeClass = (s: string) => (s === "??" ? "new" : s.includes("D") ? "del" : s.includes("A") ? "new" : "mod");
