import { useEffect, useRef, useState } from "react";
import type { ProjectSuggestion } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { tildify, timeAgo } from "../util.ts";
import { ProviderBadge } from "./ProviderBadge.tsx";

export function AddProjectDialog({ onClose }: { onClose: () => void }) {
  const { refreshProjects } = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
    void api.suggestions().then(setSuggestions, (e) => {
      setSuggestions([]);
      setSuggestError(e.message);
    });
  }, []);

  const add = async (p: string) => {
    setError("");
    try {
      const project = await api.addProject(p);
      await refreshProjects();
      onClose();
      navigate(href.home(project.id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="add-project-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add(path);
        }}
      >
        <h2 id="add-project-title">Add project</h2>
        <label className="field">
          <span>Folder path on the server</span>
          <input autoFocus placeholder="~/code/my-app" value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}

        <div className="suggest-head muted small">Folders with existing agent sessions</div>
        <ul className="suggest">
          {suggestions === null && <li className="muted small">Scanning…</li>}
          {suggestError && <li className="error small">{suggestError}</li>}
          {suggestions?.length === 0 && !suggestError && <li className="muted small">None found.</li>}
          {suggestions?.map((s) => (
            <li key={s.path}>
              <button type="button" className="suggest-item" onClick={() => void add(s.path)}>
                <span className="truncate grow">{tildify(s.path)}</span>
                {s.providers.map((p) => (
                  <ProviderBadge key={p} provider={p} />
                ))}
                <span className="muted small nowrap">
                  {s.sessionCount} · {timeAgo(s.lastActive)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!path.trim()}>Add project</button>
        </div>
      </form>
    </dialog>
  );
}
