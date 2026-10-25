import { IconCheck as Check } from "@tabler/icons-react";
import type { SprocketAsk } from "@rails/shared";

const LETTERS = "ABCDEFG"; // up to six options, then "Something else"
/** An option that only says "I'll answer another way": the card's own last row says it. */
const OTHER = /^(something|anything) else\.?$|^other\.?$/i;

/**
 * A question with options to pick (ask_user, ADR 0023), as a card in place of its bubble: the question, then a row per
 * option, lettered, and a last row that puts you in the composer to answer in your own words. Picked, the choice is
 * marked and the rest go quiet; answered in your own words instead, the whole card goes quiet ("Dismissed").
 */
export function AskCard({ ask, name, onPick }: { ask: SprocketAsk; name: string; onPick(option: string): void }) {
  const open = ask.answer === undefined;
  const options = ask.options.filter((o) => !OTHER.test(o.trim()));
  const picked = open ? undefined : options.find((o) => o === ask.answer);
  const state = open ? "" : picked ? " answered" : " dismissed";
  const ownWords = () => document.querySelector<HTMLTextAreaElement>(".sp-compose textarea")?.focus();
  return (
    <div className={"sp-bubble sp-ask-card" + state} role="group" aria-label={`${name} asks: ${ask.question}`}>
      <p className="sp-ask-q">{ask.question}</p>
      <ul className="sp-ask-options">
        {options.map((o, i) => (
          <li key={o}>
            <button type="button" className={"sp-ask-option" + (o === picked ? " picked" : "")} disabled={!open} aria-pressed={o === picked} onClick={() => onPick(o)}>
              <span className="sp-ask-letter" aria-hidden>
                {o === picked ? <Check size={13} stroke={2.5} /> : LETTERS[i]}
              </span>
              <span>{o}</span>
            </button>
          </li>
        ))}
        {open && (
          <li>
            <button type="button" className="sp-ask-option other" onClick={ownWords}>
              <span className="sp-ask-letter" aria-hidden>{LETTERS[options.length]}</span>
              <span>Something else</span>
            </button>
          </li>
        )}
      </ul>
      {!open && !picked && <p className="sp-ask-note">Dismissed</p>}
    </div>
  );
}
