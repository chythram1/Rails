import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Square } from "lucide-react";

interface Props {
  placeholder: string;
  onSubmit(text: string): void;
  disabled?: boolean;
  disabledReason?: string;
  running?: boolean;
  onInterrupt?(): void;
  autoFocus?: boolean;
  children?: ReactNode; // controls shown in the bottom row (selectors)
}

export function Composer({ placeholder, onSubmit, disabled, disabledReason, running, onInterrupt, autoFocus, children }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 320) + "px";
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSubmit(t);
    setText("");
  };

  return (
    <form
      className={"composer" + (disabled ? " is-disabled" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        aria-label="Message"
        placeholder={disabled && disabledReason ? disabledReason : placeholder}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-row">
        <div className="composer-controls">{children}</div>
        {running && onInterrupt ? (
          <button type="button" className="send-btn" aria-label="Interrupt" title="Interrupt" onClick={onInterrupt}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button className="send-btn" aria-label="Send" title="Send (Enter)" disabled={disabled || !text.trim()}>
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </form>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange(v: T): void }) {
  return (
    <label className="select">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const MODE_OPTIONS = [
  { value: "default" as const, label: "Ask before tools" },
  { value: "acceptEdits" as const, label: "Auto-accept edits" },
  { value: "plan" as const, label: "Plan only" },
  { value: "bypassPermissions" as const, label: "Bypass permissions" },
];
