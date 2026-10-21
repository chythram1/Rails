// The user's saved prompts (ADR 0020), for any Sprocket: "send my Review prompt to the API session"
// becomes a suggest_message with that prompt's text. Read-only; the user edits them in Customize.
import { Type } from "@earendil-works/pi-ai";
import { savedPrompts } from "../db.ts";
import type { Capability } from "./capabilities.ts";

export const promptsCapability: Capability = {
  name: "saved_prompts",
  description:
    "The prompts your user saved in Customize to start agents with, by name. Use one when your user refers to it by name (\"my Review prompt\"). They're your user's own text, but read-only to you.",
  params: Type.Object({}),
  output: {
    type: "array",
    items: { type: "object", properties: { name: { type: "string" }, text: { type: "string" } }, required: ["name", "text"] },
  },
  effect: "read",
  log: { doing: () => "Reading saved prompts", done: () => "read your saved prompts" },
  run: async () => savedPrompts.list().map(({ name, text }) => ({ name, text })),
};
