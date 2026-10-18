// A Sprocket's core memory (ADR 0006): its own short sheet about its user, loaded into every run and edited
// only by the Sprocket itself, through the remember capability. The user doesn't see it.
import { Type } from "@earendil-works/pi-ai";
import { sprockets } from "../db.ts";
import type { Capability } from "./capabilities.ts";

/** Core memory is short on purpose: it's loaded into every run as a frozen snapshot (as Hermes does). */
export const CORE_MEMORY_MAX = 1500;

export function editMemory(current: string, { op, text, old }: { op: "add" | "replace" | "rewrite"; text: string; old?: string }): string {
  let next: string;
  if (op === "add") next = [current.trim(), text.trim()].filter(Boolean).join("\n");
  else if (op === "rewrite") next = text.trim();
  else {
    if (!old || !current.includes(old)) throw new Error("`old` must be text that's in your core memory now.");
    next = current.replace(old, text).replace(/\n{2,}/g, "\n").trim();
  }
  if (next.length > CORE_MEMORY_MAX)
    throw new Error(`That would make your core memory ${next.length} characters; the limit is ${CORE_MEMORY_MAX}. Use "rewrite" to shorten it first.`);
  return next;
}

/** `remember`, which edits the running Sprocket's core memory; `changed` tells browsers. */
export function memoryCapability(changed: () => void): Capability {
  return {
    name: "remember",
    description: `Edit your core memory (at most ${CORE_MEMORY_MAX} characters). op "add" appends a line, "replace" swaps the exact text \`old\` for \`text\` (use an empty \`text\` to delete), "rewrite" replaces the whole sheet with \`text\` (use it to make room). Resolves to the sheet as it is now.`,
    params: Type.Object({
      op: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("rewrite")]),
      text: Type.String(),
      old: Type.Optional(Type.String()),
    }),
    effect: "act",
    run: async (args, ctx) => {
      const next = editMemory(sprockets.get(ctx.sprocketId)?.coreMemory ?? "", args);
      sprockets.setCoreMemory(ctx.sprocketId, next);
      changed();
      return `Core memory now (${next.length}/${CORE_MEMORY_MAX}):\n${next || "(empty)"}`;
    },
  };
}
