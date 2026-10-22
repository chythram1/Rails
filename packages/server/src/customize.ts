// Customize (ADR 0025): what Sprockets can use. This file holds the saved prompts; MCP servers are mcp.ts, skills
// skills.ts. Changes are broadcast as customize.changed.
import { SAVED_PROMPT_NAME_MAX, SAVED_PROMPT_TEXT_MAX, type SavedPrompt, type SavedPromptInput } from "@rails/shared";
import { savedPrompts } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { listeners } from "./util.ts";

// ---- change notifications (the terminal hub forwards these to every browser) ----
const changes = listeners();
export const onCustomizeChanged = changes.on;
/** Something in Customize changed (a prompt, a server, a skill). */
export const customizeChanged = changes.emit;
const changed = changes.emit;

// ---- saved prompts ----

function parsePrompt(body: SavedPromptInput | undefined, current?: SavedPrompt): { name: string; text: string } {
  const b = body ?? {};
  const name = b.name === undefined ? (current?.name ?? "New prompt") : typeof b.name === "string" ? b.name.trim() : "";
  const text = b.text === undefined ? (current?.text ?? "") : typeof b.text === "string" ? b.text.trim() : null;
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > SAVED_PROMPT_NAME_MAX) throw new ServiceError(`Names can be at most ${SAVED_PROMPT_NAME_MAX} characters.`, 400);
  if (text === null) throw new ServiceError("The prompt must be text", 400);
  if (text.length > SAVED_PROMPT_TEXT_MAX) throw new ServiceError(`Prompts can be at most ${SAVED_PROMPT_TEXT_MAX} characters.`, 400);
  return { name, text };
}

function getPrompt(id: string): SavedPrompt {
  const p = savedPrompts.get(id);
  if (!p) throw new ServiceError("Not found", 404);
  return p;
}

export const listPrompts = (): SavedPrompt[] => savedPrompts.list();

export function createPrompt(body: SavedPromptInput | undefined): SavedPrompt {
  const { name, text } = parsePrompt(body);
  const created = savedPrompts.create(name, text);
  changed();
  return created;
}

export function updatePrompt(id: string, body: SavedPromptInput | undefined): SavedPrompt {
  const { name, text } = parsePrompt(body, getPrompt(id));
  savedPrompts.update(id, name, text);
  changed();
  return getPrompt(id);
}

export function deletePrompt(id: string): void {
  getPrompt(id);
  savedPrompts.remove(id);
  changed();
}
