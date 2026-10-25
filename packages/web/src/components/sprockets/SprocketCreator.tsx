import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { IconChevronLeft as ChevronLeft } from "@tabler/icons-react";
import {
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  type Sprocket as SprocketData,
  type SprocketLook,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
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
  onCancel?(): void;
}

/**
 * Make a Sprocket (ref/sprockets/stage1/create-bot.jpg): the preview on top, then rows for colour and shape, then the name. Its look is chosen once, here: it can't be changed later.
 */
export function SprocketCreator({ taken, onSaved, onCancel }: Props) {
  const [look, setLook] = useState<SprocketLook>(NEW_LOOK);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const ideas = !name;
  const idea = useNameIdea(taken, ideas);
  // An empty name falls back to the idea showing.
  const shownName = name.trim() || idea;
  const set = <K extends keyof SprocketLook>(key: K) => (v: SprocketLook[K]) => setLook((l) => ({ ...l, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { name: shownName, look };
      onSaved(await api.createSprocket(body));
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="sp-creator" onSubmit={submit} aria-labelledby="sp-creator-title">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.sprockets()} aria-label="Back">
          <ChevronLeft size={18} />
        </a>
        <h2 id="sp-creator-title" className="truncate">New Sprocket</h2>
      </header>
      <div className="sp-creator-body">
        <Sprocket look={look} size={150} follow stance="front" label={`Preview of ${shownName}`} />

        <Row legend="Colour" name="sp-color" value={look.color} onChange={set("color")}
          options={SPROCKET_COLORS.map((c) => ({ value: c, label: COLOR_NAMES[c], view: <span className="sp-swatch" style={{ background: COLORS[c] }} /> }))}
          variant="swatch" narrowColumns={5} />
        <Row legend="Shape" name="sp-shape" value={look.character} onChange={set("character")}
          options={SPROCKET_CHARACTERS.map((c) => ({ value: c, label: CHARACTERS[c].name, view: <Sprocket look={{ ...look, character: c }} size={38} still /> }))} narrowColumns={4} />

        <label className="field sp-name">
          <span>Name</span>
          <span className="sp-name-input">
            {/* The placeholder holds the idea for screen readers; sighted users see it animate in the span. */}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={idea} maxLength={MAX_NAME} autoComplete="off" spellCheck={false} />
            {ideas && (
              <span key={idea} className="sp-name-idea" aria-hidden>
                {idea}
              </span>
            )}
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sp-actions">
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="btn primary" disabled={saving}>Get started</button>
        </div>
      </div>
    </form>
  );
}

/**
 * One picker row: a radio group whose options are drawn as swatches or thumbnails. Arrow keys move
 * between options; each option's name is its tooltip and its accessible name.
 */
function Row<T extends string>({ legend, name, value, options, onChange, variant = "thumb", narrowColumns }: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; view: ReactNode }[];
  onChange(v: T): void;
  variant?: "thumb" | "swatch";
  /** Columns on narrow screens, where one line doesn't fit, so the row wraps evenly. */
  narrowColumns: number;
}) {
  return (
    <fieldset className={"sp-row-picker " + variant} style={{ "--cols": narrowColumns } as React.CSSProperties}>
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
