import { SESSION_NAME_MAX, type SessionKey } from "@rails/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";

export interface Renaming {
  projectId: string;
  key: SessionKey;
  /** The name it has in Rails, if any. */
  name?: string;
  /** The agent's own title, which shows again when the name is cleared. */
  agentTitle: string;
}

/**
 * "Rename session": a small modal with one field, opened from a session's menu in the sidebar or by double-clicking
 * its tab. The name replaces the agent's title everywhere in Rails (names.ts); an empty one brings the title back.
 * It's rendered into the body, so pointer events in it don't reach a tab (which would start a drag) or a row.
 */
export function RenameSession({ renaming, onClose, returnFocus }: { renaming: Renaming; onClose(): void; returnFocus?(): HTMLElement | null }) {
  const { refreshSessions } = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(renaming.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    input.current!.select();
    // The menu item that opened it is gone by now, so the dialog can't put focus back by itself.
    return () => (d.close(), returnFocus?.()?.focus());
  }, []);

  const save = async () => {
    if (name.trim() === (renaming.name ?? "")) return onClose();
    setBusy(true);
    try {
      await api.nameSession(renaming.projectId, renaming.key, name);
      await refreshSessions(renaming.projectId);
      onClose();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="small-dialog"
      aria-labelledby="rename-title"
      aria-describedby="rename-desc"
      onCancel={(e) => (e.preventDefault(), onClose())}
      // A click on the backdrop lands on the dialog element itself; the form covers the rest.
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <form onSubmit={(e) => (e.preventDefault(), void save())}>
        <h2 id="rename-title">Rename session</h2>
        <p id="rename-desc" className="small-dialog-desc">Shown instead of the agent’s title, to you, the Coordinator and the other sessions. Leave it empty to use the agent’s title.</p>
        <input
          ref={input}
          className="input"
          aria-label="Name"
          autoComplete="off"
          spellCheck={false}
          value={name}
          maxLength={SESSION_NAME_MAX}
          placeholder={renaming.agentTitle}
          aria-invalid={!!error}
          aria-errormessage={error ? "rename-error" : undefined}
          onChange={(e) => (setName(e.target.value), setError(""))}
        />
        {error && <p id="rename-error" className="error small" role="alert">{error}</p>}
        <div className="small-dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
