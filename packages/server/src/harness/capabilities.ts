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
  /** For the run log: the step while a call runs ("Reading src/api.ts"), and what this run's calls did ("read src/api.ts"). */
  log?: { doing(args: any): string; done(calls: any[]): string };
}

/** The step a call is on, for the "Thinking…" line. */
export const stepText = (capability: Capability, args: unknown) => capability.log?.doing(args) ?? `Using ${capability.name}`;

/** "a.ts", "a.ts and b.ts", "a.ts, b.ts and c.ts", or "a.ts, b.ts and 3 more files": distinct items. */
export function listOf(items: string[], noun: string): string {
  const distinct = [...new Set(items)];
  if (distinct.length > 3) return `${distinct.slice(0, 2).join(", ")} and ${distinct.length - 2} more ${noun}`;
  return distinct.length > 1 ? `${distinct.slice(0, -1).join(", ")} and ${distinct.at(-1)}` : (distinct[0] ?? "");
}

/**
 * A run's calls in one line, in the order of first use: "Looked at the board, read 2 conversations and
 * searched for “fetchUser”". Failed calls are counted at the end; calls cut off when a script ended are left out.
 */
export function summarize(capabilities: Capability[], calls: { name: string; args: unknown; status: string }[]): string | undefined {
  const byName = new Map<string, unknown[]>();
  for (const call of calls) if (call.status === "ok") byName.set(call.name, [...(byName.get(call.name) ?? []), call.args]);
  const phrases = [...byName].map(([name, all]) => capabilities.find((c) => c.name === name)?.log?.done(all) ?? `used ${name}`);
  const failed = calls.filter((c) => c.status === "error").length;
  if (!phrases.length && !failed) return undefined;
  const text = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}` : (phrases[0] ?? "");
  const tail = failed ? `${failed} step${failed > 1 ? "s" : ""} failed` : "";
  const line = [text, tail].filter(Boolean).join("; ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** A script's arguments checked (and coerced) against the capability's schema, as pi checks a tool call. */
export function checkArgs(capability: Capability, args: unknown): any {
  const { name, description, params } = capability;
  const call = { type: "toolCall" as const, id: "codemode", name, arguments: (args ?? {}) as Record<string, any> };
  return validateToolArguments({ name, description, parameters: params }, call);
}
