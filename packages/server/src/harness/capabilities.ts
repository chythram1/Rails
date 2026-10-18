// What a Sprocket can do (ADR 0008): capabilities, plain server functions with a schema. The model reaches
// them through one tool, codemode (codemode.ts), by writing a script that calls them. Every limit (project
// scope, size caps, how much one run may change) is enforced in the capability functions, never trusted to
// the script.
import type { Tool } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { Project } from "@rails/shared";

/** What a capability runs for: the Sprocket, its project (when attached), and the call's abort signal. */
export interface RunContext {
  sprocketId: string;
  project?: Project;
  signal: AbortSignal;
}

export interface Capability {
  /** Scripts call it as `tools.<name>(args)`. */
  name: string;
  description: string;
  params: Tool["parameters"];
  /** JSON Schema of what the call resolves to. Without one it resolves to text. */
  output?: Record<string, unknown>;
  /** "act" capabilities change something (a message, the Sprocket's memory); a run may do only so many. */
  effect: "read" | "act";
  run(args: any, ctx: RunContext): Promise<unknown>;
}

/** A script's arguments checked (and coerced) against the capability's schema, as pi checks a tool call. */
export function checkArgs(capability: Capability, args: unknown): any {
  const { name, description, params } = capability;
  const call = { type: "toolCall" as const, id: "codemode", name, arguments: (args ?? {}) as Record<string, any> };
  return validateToolArguments({ name, description, parameters: params }, call);
}
