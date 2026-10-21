// Saved prompts (ADR 0020): a name and a text the user starts agents with. Home's composer and Sprocket chats fill
// one in; any Sprocket can read them (`harness/prompts.ts`).
import { SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, type SavedPrompt, type SavedPromptInput } from "@rails/shared";
import { savedPrompts } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { listeners } from "./util.ts";

// ---- change notifications (the terminal hub forwards these to every browser) ----
const promptChanges = listeners();
export const onSavedPromptsChanged = promptChanges.on;
const changed = promptChanges.emit;

const bad = (message: string) => new ServiceError(message, 400);

/** A prompt's fields from a request, checked; the ones it leaves out stay as they are. */
function parsePrompt(body: SavedPromptInput | undefined, current?: SavedPrompt): { name: string; text: string } {
  const b = body ?? {};
  const name = b.name === undefined ? (current?.name ?? "New prompt") : typeof b.name === "string" ? b.name.trim() : "";
  const text = b.text === undefined ? (current?.text ?? "") : typeof b.text === "string" ? b.text.trim() : null;
  if (!name) throw bad("Give it a name.");
  if (name.length > SAVED_PROMPT_NAME_MAX) throw bad(`Names can be at most ${SAVED_PROMPT_NAME_MAX} characters.`);
  if (text === null) throw bad("The prompt must be text.");
  if (text.length > SAVED_PROMPT_TEXT_MAX) throw bad(`Prompts can be at most ${SAVED_PROMPT_TEXT_MAX.toLocaleString("en")} characters.`);
  return { name, text };
}

function getPrompt(id: string): SavedPrompt {
  const p = savedPrompts.get(id);
  if (!p) throw new ServiceError("Saved prompt not found", 404);
  return p;
}

export const listSavedPrompts = (): SavedPrompt[] => savedPrompts.list();

export function createSavedPrompt(body?: SavedPromptInput): SavedPrompt {
  const { name, text } = parsePrompt(body);
  const p = savedPrompts.create(name, text);
  changed();
  return p;
}

export function updateSavedPrompt(id: string, body?: SavedPromptInput): SavedPrompt {
  const { name, text } = parsePrompt(body, getPrompt(id));
  savedPrompts.update(id, name, text);
  changed();
  return getPrompt(id);
}

export function deleteSavedPrompt(id: string): void {
  getPrompt(id);
  savedPrompts.remove(id);
  changed();
}
