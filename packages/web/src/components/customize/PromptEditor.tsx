import { useEffect, useRef, useState } from "react";
import { IconChevronLeft as ChevronLeft, IconMessage as Message } from "@tabler/icons-react";
import { SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, type SavedPrompt, type SavedPromptInput } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { useAutoGrow } from "../useAutoGrow.ts";
import { TextRow } from "./AgentProfileEditor.tsx";

/**
 * One saved prompt (ADR 0018): its name and its text, saved as you go like an agent profile. Home's composer and
 * Sprocket chats list them to fill in.
 */
export function PromptEditor({ prompt }: { prompt: SavedPrompt }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 2000);
    return () => clearTimeout(t);
  }, [saved]);

  const save = async (body: SavedPromptInput): Promise<boolean> => {
    try {
      await api.updatePrompt(prompt.id, body);
      setError("");
      setSaved(Date.now());
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the prompt ${prompt.name}?`)) return;
    try {
      await api.deletePrompt(prompt.id);
      navigate(href.customize());
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="cz-editor">
      <header className="sp-head">
        <a className="icon-btn sp-back" href={href.customize()} aria-label="Back to Customize">
          <ChevronLeft size={18} />
        </a>
        <span className="sp-new-icon cz-head-icon" aria-hidden>
          <Message size={16} />
        </span>
        <h2 className="truncate" title={prompt.name}>{prompt.name}</h2>
        <span className="grow" />
        <span className="muted small" role="status">{saved ? "Saved" : ""}</span>
        <a className="btn small" href={href.homeWithPrompt(prompt.id)} title="Open Home with this prompt filled in">
          Use on Home
        </a>
      </header>
      {error && (
        <p className="error cz-error" role="alert">
          {error}
        </p>
      )}
      <div className="cz-body">
        <div className="cz-form">
          <section className="set-group" aria-labelledby="cz-prompt-general">
            <h3 id="cz-prompt-general">General</h3>
            <TextRow id="cz-prompt-name" label="Name" help="Shows in the saved prompts menu." value={prompt.name} max={SAVED_PROMPT_NAME_MAX} onSave={(name) => save({ name })} required />
          </section>

          <section className="set-group" aria-labelledby="cz-prompt-text-title">
            <h3 id="cz-prompt-text-title">Prompt</h3>
            <PromptText prompt={prompt} onSave={(text) => save({ text })} />
          </section>

          <section className="set-group cz-end" aria-label="Delete">
            <div className="cz-actions">
              <button type="button" className="btn small danger" onClick={() => void remove()}>
                Delete {prompt.name}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The prompt's text, saved when the field loses focus; Escape puts it back. */
function PromptText({ prompt, onSave }: { prompt: SavedPrompt; onSave(text: string): Promise<boolean> }) {
  const [text, setText] = useState(prompt.text);
  const [editing, setEditing] = useState(false);
  const reverting = useRef(false);
  const ref = useAutoGrow(text);
  useEffect(() => {
    if (!editing) setText(prompt.text);
  }, [prompt.text, editing]);
  const commit = async () => {
    setEditing(false);
    if (reverting.current) return void (reverting.current = false);
    if (text.trim() !== prompt.text && !(await onSave(text))) setText(prompt.text);
  };
  const near = text.length > SAVED_PROMPT_TEXT_MAX * 0.8;
  return (
    <div className="settings-field cz-field">
      <label htmlFor="cz-prompt-text" className="sr-only">Prompt</label>
      <textarea
        ref={ref}
        id="cz-prompt-text"
        className="input sp-grow cz-instructions cz-prompt-text"
        rows={8}
        maxLength={SAVED_PROMPT_TEXT_MAX}
        placeholder="e.g. Review the uncommitted changes and list anything risky."
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text !== prompt.text) {
            reverting.current = true;
            setText(prompt.text);
            e.currentTarget.blur();
          }
        }}
        aria-describedby="cz-prompt-text-help"
      />
      <p id="cz-prompt-text-help" className="muted small">
        The first message an agent gets. You can still edit it in the composer before sending.
        {near ? ` ${text.length.toLocaleString()} / ${SAVED_PROMPT_TEXT_MAX.toLocaleString()}` : ""}
      </p>
    </div>
  );
}
