import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Ban, ChevronLeft } from "lucide-react";
import {
  SPROCKET_ACCESSORIES,
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  type Sprocket as SprocketData,
  type SprocketLook,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { CHARACTERS, COLORS } from "./characters.ts";
import { ACCESSORY_NAMES, COLOR_NAMES } from "./names.ts";
import { AccessoryIcon } from "./parts.tsx";
import { Sprocket } from "./Sprocket.tsx";

const NEW_LOOK: SprocketLook = { character: "block", color: "blue", accessory: "none" };

/**
 * Ready-made ideas. Picking one fills in the name and look (nothing runs yet). Their names double as the
 * name field's placeholder, which moves to the next idea each time the creator opens.
 */
const SUGGESTIONS: { name: string; about: string; look: SprocketLook }[] = [
  { name: "PR Pal", about: "Reads new pull requests and points out risky changes", look: { character: "roo", color: "blue", accessory: "cap" } },
  { name: "Changelog", about: "Turns merged work into release notes", look: { character: "block", color: "yellow", accessory: "party" } },
  { name: "Dep Doctor", about: "Keeps an eye on outdated and vulnerable packages", look: { character: "cog", color: "green", accessory: "beanie" } },
  { name: "Flake Hunter", about: "Tracks down flaky tests and suggests fixes", look: { character: "starry", color: "purple", accessory: "crown" } },
  { name: "Doc Keeper", about: "Keeps READMEs and docs in step with the code", look: { character: "lune", color: "teal", accessory: "bucket" } },
  { name: "Todo Sweeper", about: "Turns stray TODOs into a tidy task list", look: { character: "momo", color: "pink", accessory: "flower" } },
];

const NEXT_NAME_KEY = "rails.sprocketsNextName";

/**
 * Index of the next suggested name that isn't taken, going round SUGGESTIONS from where the last visit
 * stopped. Only reads: the creator stores where to continue once it has mounted (see below).
 */
function nextName(taken: string[]): number {
  const start = (Number(localStorage.getItem(NEXT_NAME_KEY)) || 0) % SUGGESTIONS.length;
  for (let i = 0; i < SUGGESTIONS.length; i++) {
    const k = (start + i) % SUGGESTIONS.length;
    if (!taken.includes(SUGGESTIONS[k].name)) return k;
  }
  return start;
}
const MAX_NAME = 40;

interface Props {
  /** The Sprocket to edit; omit to create one. */
  sprocket?: SprocketData;
  /** Names already in use, which the suggested name skips. */
  taken: string[];
  onSaved(s: SprocketData): void;
  onCancel?(): void;
}

/**
 * Make or restyle a Sprocket (ref/sprockets/stage1/create-bot.jpg): the preview on top, then rows for
 * colour, accessory (drawn on its own) and shape, then the name.
 */
export function SprocketCreator({ sprocket, taken, onSaved, onCancel }: Props) {
  const [look, setLook] = useState<SprocketLook>(sprocket?.look ?? NEW_LOOK);
  const [name, setName] = useState(sprocket?.name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // An empty name falls back to the suggested one (the placeholder).
  const [nameIdea] = useState(() => nextName(taken));
  useEffect(() => {
    if (!sprocket) localStorage.setItem(NEXT_NAME_KEY, String(nameIdea + 1)); // the next visit suggests the next name
  }, [sprocket, nameIdea]);
  const suggested = sprocket?.name ?? SUGGESTIONS[nameIdea].name;
  const shownName = name.trim() || suggested;
  const body = useRef<HTMLDivElement>(null);
  const suggest = (s: (typeof SUGGESTIONS)[number]) => {
    setLook(s.look);
    setName(s.name);
    body.current?.scrollTo({ top: 0 }); // back up to the preview
  };
  const set = <K extends keyof SprocketLook>(key: K) => (v: SprocketLook[K]) => setLook((l) => ({ ...l, [key]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const body = { name: shownName, look };
      onSaved(sprocket ? await api.updateSprocket(sprocket.id, body) : await api.createSprocket(body));
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="sp-creator" onSubmit={submit} aria-labelledby="sp-creator-title">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={sprocket ? href.sprocket(sprocket.id) : href.sprockets()} aria-label="Back">
          <ChevronLeft size={18} />
        </a>
        <h2 id="sp-creator-title" className="truncate" title={shownName}>{sprocket ? `Edit ${shownName}` : shownName}</h2>
      </header>
      <div className="sp-creator-body" ref={body}>
        <Sprocket look={look} size={150} follow label={`Preview of ${shownName}`} />

        <Row legend="Colour" name="sp-color" value={look.color} onChange={set("color")}
          options={SPROCKET_COLORS.map((c) => ({ value: c, label: COLOR_NAMES[c], view: <span className="sp-swatch" style={{ background: COLORS[c] }} /> }))}
          variant="swatch" narrowColumns={5} />
        <Row legend="Accessory" name="sp-accessory" value={look.accessory} onChange={set("accessory")}
          options={(["none", ...SPROCKET_ACCESSORIES] as const).map((a) => ({
            value: a,
            label: a === "none" ? "No accessory" : ACCESSORY_NAMES[a],
            view: a === "none" ? <Ban size={20} className="sp-none" /> : <AccessoryIcon id={a} size={32} />,
          }))} narrowColumns={4} />
        <Row legend="Shape" name="sp-shape" value={look.character} onChange={set("character")}
          options={SPROCKET_CHARACTERS.map((c) => ({ value: c, label: CHARACTERS[c].name, view: <Sprocket look={{ ...look, character: c, accessory: "none" }} size={38} still /> }))} narrowColumns={4} />

        <label className="field sp-name">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} maxLength={MAX_NAME} autoComplete="off" spellCheck={false} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sp-actions">
          {onCancel && (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="btn primary" disabled={saving}>{sprocket ? "Save changes" : "Get started"}</button>
        </div>
        {!sprocket && (
          <section className="sp-suggestions" aria-labelledby="sp-suggestions-title">
            <h3 id="sp-suggestions-title">Suggestions</h3>
            <ul>
              {SUGGESTIONS.filter((s) => !taken.includes(s.name)).map((s) => (
                <li key={s.name}>
                  <button type="button" className="sp-suggestion" onClick={() => suggest(s)}>
                    <Sprocket look={s.look} size={48} still />
                    <span className="sp-suggestion-text">
                      <span className="sp-card-name">{s.name}</span>
                      <span className="muted small">{s.about}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
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
