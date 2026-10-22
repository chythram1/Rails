import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface Props {
  title: string;
  /** What happens, in a line or two. */
  text: string;
  /** The confirming button's label ("Clear chat"): says what it does, never just "OK". A notice's one button. */
  action: string;
  /** Does it delete something? Then the button is a danger one, and Cancel has the focus. */
  danger?: boolean;
  /** Do it. A thrown error shows in the dialog, which stays open. Left out, it's a notice: one button that closes it. */
  onConfirm?(): Promise<void>;
  onClose(): void;
  /** Where focus goes once it closes, when what opened it (a menu item) is gone. */
  returnFocus?(): HTMLElement | null;
}

/**
 * An in-app confirmation, in the small dialog's frame (as Rename session): the title, what will happen, Cancel and the
 * action. Rendered into the body, so pointer events in it don't reach what's under it.
 */
export function ConfirmDialog({ title, text, action, danger = false, onConfirm, onClose, returnFocus }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const d = dialog.current!;
    d.showModal();
    (danger && onConfirm ? cancel : confirm).current!.focus();
    return () => (d.close(), returnFocus?.()?.focus());
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm?.();
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
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onCancel={(e) => (e.preventDefault(), onClose())}
      // A click on the backdrop lands on the dialog element itself; the form covers the rest. React passes events
      // up through the portal to whatever rendered it (a panel that closes on Escape): keep them here.
      onClick={(e) => (e.stopPropagation(), e.target === dialog.current && onClose())}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form onSubmit={(e) => (e.preventDefault(), void run())}>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-desc" className="small-dialog-desc">{text}</p>
        {error && <p className="error small" role="alert">{error}</p>}
        <div className="small-dialog-actions">
          {onConfirm && (
            <button ref={cancel} type="button" className="btn" onClick={onClose}>Cancel</button>
          )}
          <button ref={confirm} className={"btn" + (danger ? " danger" : " primary")} disabled={busy}>{action}</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

/** A confirmation to show when asked: render `dialog`, call `ask` with what to confirm. */
export function useConfirm() {
  const [asked, ask] = useState<Omit<Props, "onClose"> | null>(null);
  const dialog = asked && <ConfirmDialog {...asked} onClose={() => ask(null)} />;
  return [dialog, ask] as const;
}

// Notices: what went wrong with something done outside a dialog (adding a project, opening a panel), shown by
// <Notices /> (App.tsx), one at a time.
type Notice = { title: string; text: string };
let notices: Notice[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function showNotice(title: string, text: string) {
  notices = [...notices, { title, text }];
  changed();
}

export function Notices() {
  const list = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => notices,
  );
  const now = list[0];
  if (!now) return null;
  const close = () => {
    notices = notices.slice(1);
    changed();
  };
  return <ConfirmDialog key={list.length + now.title} title={now.title} text={now.text} action="Close" onClose={close} />;
}
