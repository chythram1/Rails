import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX as X } from "@tabler/icons-react";
import {
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  type Sprocket as SprocketData,
  type SprocketLook,
} from "@rails/shared";
import { api } from "../../api.ts";
import { CHARACTERS, COLORS } from "./characters.ts";
import { COLOR_NAMES } from "./names.ts";
import { Sprocket } from "./Sprocket.tsx";

const NEW_LOOK: SprocketLook = { character: "block", color: "blue" };

/** Name ideas, shown one after another in the empty name field; an empty name takes the one showing. */
const NAME_IDEAS = ["PR Pal", "Changelog", "Dep Doctor", "Flake Hunter", "Doc Keeper", "Todo Sweeper"];
/** How long each idea shows (matches the sp-name-idea animation in styles.css). */
const IDEA_MS = 2600;

/** The name idea showing now. Skips names already in use and moves on every IDEA_MS while `cycling`. */
function useNameIdea(taken: string[], cycling: boolean): string {
  const free = NAME_IDEAS.filter((n) => !taken.includes(n));
  const ideas = free.length ? free : NAME_IDEAS;
  const [i, setI] = useState(() => Math.floor(Math.random() * NAME_IDEAS.length));
  useEffect(() => {
    if (!cycling) return;
    const timer = setInterval(() => setI((n) => n + 1), IDEA_MS);
    return () => clearInterval(timer);
  }, [cycling]);
  return ideas[i % ideas.length];
}

const MAX_NAME = 40;

interface Props {
  /** Names already in use, which the name ideas skip. */
  taken: string[];
  onSaved(s: SprocketData): void;
  onClose(): void;
}

/**
 * Make a Sprocket, in a dialog over the page: a header with the title and a close button, then the preview, the name,
 * the shapes and the colours, centred, then Cancel and Create on a rule. Its look is chosen once, here: it can't be
 * changed later.
 */
export function SprocketCreator({ taken, onSaved, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [look, setLook] = useState<SprocketLook>(NEW_LOOK);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ideas = !name;
  const idea = useNameIdea(taken, ideas);
  // An empty name falls back to the idea showing.
  const shownName = name.trim() || idea;
  const set = <K extends keyof SprocketLook>(key: K) => (v: SprocketLook[K]) => setLook((l) => ({ ...l, [key]: v }));

  useLayoutEffect(() => {
    // Focus goes back to what opened it, or to the list's New button when that's gone (a menu item) or unknown.
    const opener = document.activeElement as HTMLElement | null;
    const d = dialog.current!;
    d.showModal();
    input.current!.focus();
    return () => {
      d.close();
      const back = opener && opener !== document.body && opener.isConnected ? opener : document.querySelector<HTMLElement>(".sp-new-btn");
      back?.focus();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      onSaved(await api.createSprocket({ name: shownName, look }));
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialog}
      className="small-dialog sp-create"
      aria-labelledby="sp-creator-title"
      onCancel={(e) => (e.preventDefault(), onClose())}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <form onSubmit={submit}>
        <header className="sp-create-head">
          <h2 id="sp-creator-title">New Sprocket</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="sp-create-body">
          <Sprocket look={look} size={112} follow stance="front" label={`Preview of ${shownName}`} />
          <label className="sp-name">
            <span className="sr-only">Name</span>
            <span className="sp-name-input">
              {/* The placeholder holds the idea for screen readers; sighted users see it animate in the span. */}
              <input ref={input} className="input" value={name} onChange={(e) => (setName(e.target.value), setError(""))} placeholder={idea} maxLength={MAX_NAME} autoComplete="off" spellCheck={false} />
              {ideas && (
                <span key={idea} className="sp-name-idea" aria-hidden>
                  {idea}
                </span>
              )}
            </span>
          </label>
          <Row legend="Shape" name="sp-shape" value={look.character} onChange={set("character")} columns={4}
            options={SPROCKET_CHARACTERS.map((c) => ({ value: c, label: CHARACTERS[c].name, view: <Sprocket look={{ ...look, character: c }} size={54} still /> }))} />
          <Row legend="Colour" name="sp-color" value={look.color} onChange={set("color")} variant="swatch" columns={5}
            options={SPROCKET_COLORS.map((c) => ({ value: c, label: COLOR_NAMES[c], view: <span className="sp-swatch" style={{ background: COLORS[c] }} /> }))} />
          {error && <p className="error small" role="alert">{error}</p>}
        </div>
        <footer className="sp-create-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>Create</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

/**
 * One picker: a radio group whose options are drawn as swatches or thumbnails, in a grid of `columns`. Arrow keys
 * move between options; each option's name is its tooltip and its accessible name.
 */
function Row<T extends string>({ legend, name, value, options, onChange, variant = "thumb", columns }: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; view: ReactNode }[];
  onChange(v: T): void;
  variant?: "thumb" | "swatch";
  columns: number;
}) {
  return (
    <fieldset className={"sp-row-picker " + variant} style={{ "--cols": columns } as React.CSSProperties}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="sp-pick" title={o.label}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} aria-label={o.label} />
          {o.view}
        </label>
      ))}
    </fieldset>
  );
}
