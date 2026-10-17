// Sprockets: always-on agents (ADR 0005). Stage 1 stores their look, name and the messages the user
// sends them; nothing runs yet, so they never reply.
import {
  SPROCKET_ACCESSORIES,
  SPROCKET_CHARACTERS,
  SPROCKET_COLORS,
  type Sprocket,
  type SprocketInput,
  type SprocketLook,
  type SprocketMessage,
} from "@rails/shared";
import { sprocketMessages, sprockets } from "./db.ts";
import { ServiceError } from "./errors.ts";

const MAX_NAME = 40;
const MAX_MESSAGE = 4000;

// ---- change notifications (the terminal hub forwards these to every browser) ----
const listeners = new Set<() => void>();
export const onSprocketsChanged = (fn: () => void) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

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

function withLook(row: ReturnType<typeof sprockets.list>[number]): Sprocket {
  return { ...row, look: repairLook(row.look), lastMessage: sprocketMessages.last(row.id) };
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

/** Store a message to a Sprocket. Nothing answers it yet (stage 1). */
export function sendMessage(sprocketId: string, rawText: unknown): SprocketMessage {
  getSprocket(sprocketId);
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) throw new ServiceError("Message is empty", 400);
  if (text.length > MAX_MESSAGE) throw new ServiceError(`Messages can be at most ${MAX_MESSAGE} characters.`, 400);
  const message = sprocketMessages.create(sprocketId, text);
  changed();
  return message;
}
