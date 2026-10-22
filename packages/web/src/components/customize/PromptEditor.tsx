import { useState } from "react";
import { IconDots as Dots } from "@tabler/icons-react";
import { SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, type SavedPrompt, type SavedPromptInput } from "@rails/shared";
import { api } from "../../api.ts";
import { href, navigate } from "../../router.ts";
import { MenuButton } from "../Menu.tsx";
import { EditorHead, LongText, TextInput } from "./fields.tsx";
import { useConfirm } from "../ConfirmDialog.tsx";

/** One saved prompt: its name and its text. Home's composer lists them to fill in. */
export function PromptEditor({ prompt }: { prompt: SavedPrompt }) {
  const { id, name } = prompt;
  const [error, setError] = useState("");

  const save = async (body: SavedPromptInput) => {
    setError("");
    try {
      await api.updatePrompt(id, body);
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const [confirmDialog, ask] = useConfirm();
  const remove = () =>
    ask({
      title: `Delete ${name}?`,
      text: "The prompt is deleted, on every device.",
      action: "Delete prompt",
      danger: true,
      // It opened from the `…` menu, whose item is gone: back to the menu's button.
      returnFocus: () => document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(`${name} actions`)}"]`),
      onConfirm: async () => {
        await api.deletePrompt(id);
        navigate(href.customize("prompts"));
      },
    });

  return (
    <div className="cz-editor">
      {confirmDialog}
      <EditorHead back={href.customize("prompts")} backLabel="Prompts" title={name}>
        <a className="btn small" href={href.homeWithPrompt(id)} title="Open Home with this prompt filled in">Use on Home</a>
        <MenuButton label={`${name} actions`} title="More" icon={<Dots size={18} />} align="right" items={[{ label: "Delete prompt", danger: true, onSelect: () => void remove() }]} />
      </EditorHead>
      <div className="cz-body">
        <section className="set-group" aria-labelledby="cz-prompt-title">
          <h3 id="cz-prompt-title">Saved prompt</h3>
          <div className="set-row">
            <div className="set-text">
              <label htmlFor="cz-prompt-name">Name</label>
              <p>Shown in Home's prompt list.</p>
            </div>
            <TextInput id="cz-prompt-name" value={name} maxLength={SAVED_PROMPT_NAME_MAX} onSave={(v) => save({ name: v })} />
          </div>
        </section>
        <LongText
          id="cz-prompt-text"
          label="Prompt"
          help="The first message an agent gets. You can still edit it in the composer before sending."
          value={prompt.text}
          maxLength={SAVED_PROMPT_TEXT_MAX}
          rows={10}
          placeholder="e.g. “Review the uncommitted changes and list anything risky.”"
          onSave={(v) => save({ text: v })}
        />
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
