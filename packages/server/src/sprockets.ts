// Sprockets: always-on agents (ADR 0005, 0006): their look, name, chat and settings. A Sprocket is
// attached to at most one project; moving it (or detaching it) deletes the chat it had there, while its
// name, look, description and core memory stay. Replies are written by runs.ts. Core memory is the
// Sprocket's own (it edits it with the remember tool) and never leaves the server.
import {
  SPROCKET_ACCESSORIES,
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  SPROCKET_DESCRIPTION_MAX,
  type Sprocket,
  type SprocketInput,
  type SprocketLook,
  type SprocketMessage,
  type SprocketSettings,
} from "@rails/shared";
import { projects, sprocketMessages, sprockets } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { findModel } from "./models.ts";
import { isRunning, onRunsChanged, requestReply, userMessageTime } from "./runs.ts";
import { listeners } from "./util.ts";

const MAX_NAME = 40;
const MAX_MESSAGE = 4000;

// ---- change notifications (the terminal hub forwards these to every browser) ----
const sprocketChanges = listeners();
export const onSprocketsChanged = sprocketChanges.on;
const changed = sprocketChanges.emit;
onRunsChanged(changed);

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/** A look from a request. Unknown ids are refused, so a stale client can't store junk. */
function parseLook(raw: unknown): SprocketLook {
  const look = (raw ?? {}) as Record<string, unknown>;
  const accessory = look.accessory ?? "none";
  if (!isOneOf(SPROCKET_CHARACTERS, look.character)) throw new ServiceError("Unknown character", 400);
  if (!isOneOf(SPROCKET_COLORS, look.color)) throw new ServiceError("Unknown colour", 400);
  if (accessory !== "none" && !isOneOf(SPROCKET_ACCESSORIES, accessory)) throw new ServiceError("Unknown accessory", 400);
  return { character: look.character, color: look.color, accessory: accessory as SprocketLook["accessory"] };
}

/** A stored look, with ids that no longer exist replaced by defaults instead of breaking the page. */
function repairLook(raw: unknown): SprocketLook {
  const look = (raw ?? {}) as Record<string, unknown>;
  return {
    character: isOneOf(SPROCKET_CHARACTERS, look.character) ? look.character : "block",
    color: isOneOf(SPROCKET_COLORS, look.color) ? look.color : "yellow",
    accessory: isOneOf(SPROCKET_ACCESSORIES, look.accessory) ? look.accessory : "none",
  };
}

function parseInput(body: Partial<SprocketInput> | undefined): SprocketInput {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > MAX_NAME) throw new ServiceError(`Names can be at most ${MAX_NAME} characters.`, 400);
  return { name, look: parseLook(body?.look) };
}

function withLook({ coreMemory: _internal, ...row }: ReturnType<typeof sprockets.list>[number]): Sprocket {
  return { ...row, look: repairLook(row.look), running: isRunning(row.id), lastMessage: sprocketMessages.last(row.id) };
}

function getSprocket(id: string): Sprocket {
  const row = sprockets.get(id);
  if (!row) throw new ServiceError("Not found", 404);
  return withLook(row);
}

export function listSprockets(): Sprocket[] {
  return sprockets.list().map(withLook);
}

export function createSprocket(body: Partial<SprocketInput> | undefined): Sprocket {
  const { name, look } = parseInput(body);
  const created = withLook(sprockets.create(name, look));
  changed();
  return created;
}

export function updateSprocket(id: string, body: Partial<SprocketInput> | undefined): Sprocket {
  getSprocket(id);
  const { name, look } = parseInput(body);
  sprockets.update(id, name, look);
  changed();
  return getSprocket(id);
}

/** Delete a Sprocket and its messages. */
export function deleteSprocket(id: string): void {
  getSprocket(id);
  sprockets.remove(id);
  changed();
}

export function listMessages(sprocketId: string): SprocketMessage[] {
  getSprocket(sprocketId);
  return sprocketMessages.list(sprocketId);
}

/** Store the user's message to a Sprocket and ask it to reply. */
export function sendMessage(sprocketId: string, rawText: unknown): SprocketMessage {
  getSprocket(sprocketId);
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) throw new ServiceError("Message is empty", 400);
  if (text.length > MAX_MESSAGE) throw new ServiceError(`Messages can be at most ${MAX_MESSAGE} characters.`, 400);
  const message = sprocketMessages.create(sprocketId, "user", text, userMessageTime(sprocketId));
  changed();
  requestReply(sprocketId);
  return message;
}

/**
 * Change a Sprocket's project, model or core memory. Every field is checked before any is applied, so a
 * rejected request changes nothing (moving a Sprocket deletes its chat). Changing the project deletes it.
 */
export function updateSettings(id: string, body: SprocketSettings | undefined): Sprocket {
  const s = getSprocket(id);
  const { projectId, model, description } = body ?? {};
  const moving = projectId !== undefined && (projectId ?? undefined) !== s.projectId;
  if (moving) {
    if (projectId !== null && (typeof projectId !== "string" || !projects.get(projectId))) throw new ServiceError("Unknown project", 400);
    if (isRunning(id)) throw new ServiceError(`${s.name} is replying. Try again when it's done.`, 409);
  }
  if (model !== undefined && model !== null && (typeof model !== "string" || !findModel(model))) throw new ServiceError("Unknown model", 400);
  if (description !== undefined) {
    if (typeof description !== "string") throw new ServiceError("The description must be text", 400);
    if (description.trim().length > SPROCKET_DESCRIPTION_MAX)
      throw new ServiceError(`Descriptions can be at most ${SPROCKET_DESCRIPTION_MAX} characters.`, 400);
  }

  if (moving) sprockets.setProject(id, projectId ?? null);
  if (model !== undefined) sprockets.setModel(id, model);
  if (description !== undefined) sprockets.setDescription(id, description.trim());
  changed();
  return getSprocket(id);
}

/** A project is being removed from rails: its Sprockets are detached (and their chats there deleted). */
export function detachFromProject(projectId: string): void {
  const attached = sprockets.byProject(projectId);
  for (const s of attached) sprockets.setProject(s.id, null);
  if (attached.length) changed();
}
