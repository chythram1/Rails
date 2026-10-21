import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowUp as ArrowUp } from "@tabler/icons-react";

interface Props {
  placeholder: string;
  onSubmit(text: string): void;
  disabled?: boolean;
  disabledReason?: string;
  autoFocus?: boolean;
  /** One line with the send button beside the text (chat threads), instead of the tall home box. */
  compact?: boolean;
  children?: ReactNode; // controls shown in the bottom row (selectors)
  /** Put this text in the box (a saved prompt), replacing what's there. A new object each time. */
  fill?: { text: string };
}

export function Composer({ placeholder, onSubmit, disabled, disabledReason, autoFocus, compact, children, fill }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!fill) return;
    setText(fill.text);
    ref.current?.focus();
  }, [fill]);

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
      className={"composer" + (compact ? " compact" : "") + (disabled ? " is-disabled" : "")}
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
        {children && <div className="composer-controls">{children}</div>}
        <button className="send-btn" aria-label="Send" title="Send (Enter)" disabled={disabled || !text.trim()}>
          <ArrowUp size={18} />
        </button>
      </div>
    </form>
  );
}
