import { useEffect, useState, type ReactNode } from "react";
import { IconChevronLeft as ChevronLeft } from "@tabler/icons-react";

// What Customize's pages share: the head with the way back, a one-line field saved on blur, and a long text with Save.

/** A one-line field saved when it loses focus (or on Enter); Escape puts it back. A refused value goes back too. */
export function TextInput(props: { id: string; value: string; maxLength: number; placeholder?: string; onSave(value: string): Promise<boolean> }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  const commit = async () => {
    if (value.trim() === props.value) return setValue(props.value);
    if (!(await props.onSave(value.trim()))) setValue(props.value);
  };
  return (
    <input
      id={props.id}
      className="input"
      maxLength={props.maxLength}
      placeholder={props.placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setValue(props.value);
      }}
    />
  );
}

/** A long text with Save and Undo under it (like a Sprocket's description), and its length when it has a limit. */
export function LongText(props: {
  id: string;
  label: string;
  /** The section's heading already names it: keep the label for screen readers only. */
  hideLabel?: boolean;
  help?: string;
  value: string;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  onSave(value: string): Promise<boolean>;
}) {
  const [text, setText] = useState(props.value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(props.value), [props.value]);
  const dirty = text.trim() !== props.value;
  return (
    <form
      className="settings-field"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await props.onSave(text)) setSaved(true);
      }}
    >
      <label htmlFor={props.id} className={props.hideLabel ? "sr-only" : undefined}>{props.label}</label>
      {props.help && <p id={`${props.id}-help`} className="muted small">{props.help}</p>}
      <textarea
        id={props.id}
        className="input"
        rows={props.rows ?? 4}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => (setText(e.target.value), setSaved(false))}
        aria-describedby={props.help ? `${props.id}-help` : undefined}
      />
      <div className="sp-field-foot">
        {props.maxLength && <span className="muted small">{text.length} / {props.maxLength}</span>}
        <span className="grow" />
        {saved && !dirty && <span className="muted small" role="status">Saved</span>}
        {dirty && <button type="button" className="btn small" onClick={() => setText(props.value)}>Undo</button>}
        <button className="btn small primary" disabled={!dirty}>Save</button>
      </div>
    </form>
  );
}

/**
 * The head of an open item: the way back to its tab ("‹ Connectors"), its name if the page has no big title of its
 * own, then its actions at the right.
 */
export function EditorHead({ back, backLabel, title, children }: { back: string; backLabel: string; title?: string; children?: ReactNode }) {
  return (
    <header className="sp-head cz-head">
      <a className="cz-back" href={back}>
        <ChevronLeft size={16} aria-hidden />
        {backLabel}
      </a>
      {title && (
        <>
          <span className="cz-head-sep" aria-hidden>
            /
          </span>
          <h2 className="truncate" title={title}>
            {title}
          </h2>
        </>
      )}
      <span className="grow" />
      {children}
    </header>
  );
}
