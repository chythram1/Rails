import { useState, type FormEvent } from "react";
import { ChevronLeft } from "lucide-react";
import {
  SPROCKET_CHARACTERS,
  SPROCKET_SLOTS,
  type Sprocket as SprocketData,
  type SprocketLook,
  type SprocketSlot,
} from "@rails/shared";
import { api } from "../../api.ts";
import { href } from "../../router.ts";
import { CHARACTERS } from "./characters.ts";
import { ACCESSORY_NAMES, SLOT_NAMES } from "./names.ts";
import { Sprocket } from "./Sprocket.tsx";

const NEW_LOOK: SprocketLook = { character: "block", head: "none", eyes: "none", neck: "none" };
const MAX_NAME = 40;

interface Props {
  /** The Sprocket to edit; omit to create one. */
  sprocket?: SprocketData;
  onSaved(s: SprocketData): void;
  onCancel?(): void;
}

/** Make or restyle a Sprocket: pick a character, one accessory per slot, and a name. */
export function SprocketCreator({ sprocket, onSaved, onCancel }: Props) {
  const [look, setLook] = useState<SprocketLook>(sprocket?.look ?? NEW_LOOK);
  const [name, setName] = useState(sprocket?.name ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const character = CHARACTERS[look.character];
  // An empty name falls back to the character's own name.
  const shownName = name.trim() || character.name;

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
        <h2 id="sp-creator-title" className="truncate">{sprocket ? `Edit ${sprocket.name}` : "New Sprocket"}</h2>
      </header>
      <div className="sp-creator-body">
        <div className="sp-stage">
          <Sprocket look={look} size={180} follow label={`Preview of ${shownName}`} />
          <p className="sp-stage-name" aria-hidden>{shownName}</p>
        </div>
        <div className="sp-controls">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={character.name} maxLength={MAX_NAME} autoComplete="off" spellCheck={false} />
          </label>
          <Options
            legend="Character"
            value={look.character}
            options={SPROCKET_CHARACTERS.map((c) => ({ value: c, label: CHARACTERS[c].name, look: { ...look, character: c } }))}
            onChange={(character) => setLook((l) => ({ ...l, character }))}
          />
          {(Object.keys(SPROCKET_SLOTS) as SprocketSlot[]).map((slot) => (
            <Options
              key={slot}
              legend={SLOT_NAMES[slot]}
              value={look[slot]}
              options={(["none", ...SPROCKET_SLOTS[slot]] as SprocketLook[typeof slot][]).map((v) => ({
                value: v,
                label: v === "none" ? "None" : ACCESSORY_NAMES[v],
                look: { ...look, [slot]: v },
              }))}
              onChange={(v) => setLook((l) => ({ ...l, [slot]: v }))}
            />
          ))}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sp-actions">
            <button className="btn primary" disabled={saving}>{sprocket ? "Save changes" : "Create Sprocket"}</button>
            {onCancel && (
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

/** A radio group drawn as thumbnails: each option shows the Sprocket as it would look with it. */
function Options<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: { value: T; label: string; look: SprocketLook }[]; onChange(v: T): void }) {
  const group = "sp-" + legend.toLowerCase();
  return (
    <fieldset className="sp-group">
      <legend>{legend}</legend>
      <div className="sp-options">
        {options.map((o) => (
          <label key={o.value} className="sp-option">
            <input type="radio" name={group} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
            <Sprocket look={o.look} size={56} still />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
