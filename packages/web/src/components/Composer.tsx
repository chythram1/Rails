import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  /** Names `@` completes (a team's members, ADR 0022): typing `@` and part of one lists the ones that fit. */
  mentions?: Mention[];
}

export interface Mention {
  name: string;
  /** Muted text after the name ("Lead"). */
  note?: string;
  icon?: ReactNode;
}

/**
 * The @mention being typed: the `@` (at the start or after a space) before the cursor and what follows it, on one
 * line. Done (null) once it ends in a space, as it does after a pick.
 */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0 || (start > 0 && !/\s/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (query.length > 40 || /\n/.test(query) || /\s$/.test(query)) return null;
  return { start, query };
}

/** How well `name` fits `query`: its start, then a word's start, then anywhere, then its letters in order; -1 not at all. */
function fit(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  return i === q.length ? 3 : -1;
}

export function Composer({ placeholder, onSubmit, disabled, disabledReason, autoFocus, compact, children, fill, mentions }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  /** Where the cursor is, for the @mention being typed. */
  const [caret, setCaret] = useState(0);
  /** The highlighted suggestion, and an @ whose suggestions were dismissed with Escape. */
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const typing = mentions?.length ? mentionAt(text, caret) : null;
  const options =
    typing && typing.start !== dismissed
      ? mentions!
          .map((m, i) => ({ m, i, score: fit(m.name, typing.query) }))
          .filter((o) => o.score >= 0)
          .sort((a, b) => a.score - b.score || a.i - b.i)
          .map((o) => o.m)
      : [];
  const open = options.length > 0;
  const shown = Math.min(active, options.length - 1);

  /** Put `@name ` in place of what was typed after the @, and the cursor after it. */
  const pick = (m: Mention) => {
    if (!typing) return;
    const added = `@${m.name} `;
    const at = typing.start + added.length;
    setText(text.slice(0, typing.start) + added + text.slice(caret));
    setCaret(at);
    requestAnimationFrame(() => ref.current?.setSelectionRange(at, at));
  };

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
    setDismissed(null);
  };

  return (
    <form
      className={"composer" + (compact ? " compact" : "") + (disabled ? " is-disabled" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {open && (
        <ul id={listId} className="mention-list" role="listbox" aria-label="Mention">
          {options.map((m, i) => (
            <li
              key={m.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === shown}
              // Keep the focus in the box: a click picks without blurring it.
              onMouseDown={(e) => (e.preventDefault(), pick(m))}
              onMouseMove={() => setActive(i)}
            >
              {m.icon}
              <span className="truncate">{m.name}</span>
              {m.note && <span className="muted small">{m.note}</span>}
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={ref}
        rows={1}
        aria-label="Message"
        placeholder={disabled && disabledReason ? disabledReason : placeholder}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        {...(mentions?.length
          ? {
              role: "combobox",
              "aria-autocomplete": "list" as const,
              "aria-expanded": open,
              "aria-controls": open ? listId : undefined,
              "aria-activedescendant": open ? `${listId}-${shown}` : undefined,
            }
          : {})}
        onChange={(e) => (setText(e.target.value), setCaret(e.target.selectionStart), setActive(0))}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((shown + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              pick(options[shown]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(typing!.start);
              return;
            }
          }
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
