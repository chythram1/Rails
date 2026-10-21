// The codemode tool (ADR 0008): the model writes JavaScript that calls a Sprocket's capabilities, and only
// the script's output reaches it. Modeled on pi's own codemode tool (pi-coding-agent's
// extensions/codemode/tool.ts and execute.ts) and run in its sandbox, @earendil-works/pi-codemode (QuickJS in
// WebAssembly, in a worker thread): the same script format, description, result format and store. What differs
// for Sprockets, which run unattended inside the Rails server: a default deadline, no images, no tool search
// (they have a dozen capabilities), output trimmed rather than saved to a file they couldn't read, and a cap on
// how many changes ("act" capabilities) one run may make.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { CodemodeSandbox, parseCodemodeSource, renderToolSample, type CodemodeJsonSchema, type CodemodeOutputItem, type CodemodeResult } from "@earendil-works/pi-codemode";
import { checkArgs, type Capability, type RunContext } from "./capabilities.ts";

export const CODEMODE_TOOL_NAME = "codemode";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const CHARS_PER_TOKEN = 4;
/** The VM's heap. Without a limit a runaway script could grow the Rails server's memory. */
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
/** Scripts running at once, across Sprockets (like pi: room for one replacement while another exits). */
const MAX_WORKERS = 2;
/** Changes ("act" capabilities) one run may make, across its scripts. */
export const MAX_ACTS_PER_RUN = 10;
const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;
let activeWorkers = 0;

/** One capability call a script made, for the run log. */
export interface CallRecord {
  name: string;
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
}

export interface CodemodeHooks {
  /** Values `load()` reads, kept per Sprocket. */
  store(): Record<string, unknown>;
  /** A successful script's `store()` writes. */
  saveStore(writes: { set: Record<string, unknown>; delete: string[] }): void;
  /** A call started, and ended (for the run log and the live "Thinking…" line). */
  onCallStart?(capability: Capability, args: unknown): void;
  onCallEnd?(capability: Capability, args: unknown, status: CallRecord["status"]): void;
  /** True once a script ended the run's turn (pass_turn, ask_user; ADR 0023): no model call follows it. */
  ends?(): boolean;
}

const params = Type.Object({ code: Type.String({ description: "Raw JavaScript source." }) });
const TEXT_OUTPUT = { type: "string" };

const DESCRIPTION_INTRO = `Run JavaScript that calls your tools. The input is raw JavaScript (not JSON, no code fence), run as an async function body in a QuickJS sandbox: top-level \`await\` and \`return\` work. No Node, file system, network, or timers.
- \`await tools.<name>({ ...args })\` resolves to a string, or an object if the tool's declaration says so, and rejects with an Error on failure. Calls still running when the script ends are cancelled.
- Optional first line: \`// @options: {"max_output_tokens": 10000, "timeout_ms": 60000}\` (at most ${MAX_TIMEOUT_MS / 1000} s).`;

const GLOBALS = [
  "Globals:",
  "- `text(value)`, `console.log(...)`, and top-level `return` add output; `exit()` ends the script. With several text items, each starts with a `==> text N/M <==` line, and `console` lines follow the other output in one `<console_output>` block.",
  "- `store(key, value)` and `load(key)` keep JSON values across codemode calls.",
  "- `ALL_TOOLS` lists every tool as `{ name, description }`.",
].join("\n");

/** The model-facing description: how scripts work, then each capability with its TypeScript declaration. */
export function codemodeDescription(capabilities: Capability[]): string {
  const sections = capabilities.map((c) => `### \`${c.name}\`\n${renderToolSample(declaration(c)).trim()}`);
  return [DESCRIPTION_INTRO, GLOBALS, ...(sections.length ? [["Nested tools:", ...sections].join("\n\n")] : [])].join("\n\n");
}

/** A capability as pi-codemode declares it. A TypeBox schema is a JSON Schema object already. */
const declaration = (c: Capability) => ({
  name: c.name,
  description: c.description,
  inputSchema: c.params as unknown as CodemodeJsonSchema,
  outputSchema: (c.output ?? TEXT_OUTPUT) as CodemodeJsonSchema,
});

/**
 * The codemode tool for one run. `ctx` scopes every capability call; the act cap counts across all the
 * run's scripts, so a run can't loop around it one script at a time.
 */
export function codemodeTool(capabilities: Capability[], ctx: Omit<RunContext, "signal">, hooks: CodemodeHooks): AgentTool<typeof params> {
  let acts = 0;
  return {
    name: CODEMODE_TOOL_NAME,
    label: "Code",
    description: codemodeDescription(capabilities),
    parameters: params,
    execute: async (_toolCallId, input, signal) => {
      const startedAt = performance.now();
      const { code, options } = parseCodemodeSource(input.code);
      const calls: CallRecord[] = [];
      const tools = capabilities.map((capability) => ({
        ...declaration(capability),
        description: renderToolSample(declaration(capability)),
        execute: async (args: unknown, { signal: callSignal }: { signal: AbortSignal }) => {
          const record: CallRecord = { name: capability.name, args: preview(args), status: "running" };
          calls.push(record);
          const callStartedAt = performance.now();
          let checked: unknown = args;
          try {
            if (capability.effect === "act" && ++acts > MAX_ACTS_PER_RUN) {
              throw new Error(`This run has already made ${MAX_ACTS_PER_RUN} changes, the most one run may make.`);
            }
            checked = checkArgs(capability, args);
            hooks.onCallStart?.(capability, checked);
            const value = await capability.run(checked, { ...ctx, signal: callSignal });
            record.status = "ok";
            return capability.output ? value : String(value ?? "");
          } catch (e) {
            record.status = callSignal.aborted ? "cancelled" : "error";
            record.error = truncate((e as Error).message, ERROR_PREVIEW_CHARS);
            throw e;
          } finally {
            record.durationMs = performance.now() - callStartedAt;
            hooks.onCallEnd?.(capability, checked, record.status);
          }
        },
      }));
      const sandbox = new CodemodeSandbox({
        tools,
        timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        memoryLimitBytes: MEMORY_LIMIT_BYTES,
        acquireWorker: () => {
          if (activeWorkers >= MAX_WORKERS) throw new Error(`Too many scripts are running (${MAX_WORKERS}). Try again in a moment.`);
          activeWorkers++;
          return () => void activeWorkers--;
        },
      });
      let result: CodemodeResult;
      try {
        result = await sandbox.execute(code, { signal, store: hooks.store() });
      } finally {
        await sandbox.close();
      }
      // Calls still marked running were cut off by the script ending, a timeout, or an abort.
      for (const call of calls) if (call.status === "running") call.status = "cancelled";

      const output = [...result.output];
      if (result.ok) {
        const { set, delete: deleted } = result.storeWrites;
        if (Object.keys(set).length || deleted.length) hooks.saveStore({ set, delete: deleted });
        if (result.value !== undefined) output.push({ type: "text", text: valueText(result.value) }); // like pi: a returned value is added like text()
      }
      const items = formatOutput(output);
      if (!result.ok) items.push(`Script error:\n${formatError(result, calls)}`);
      const text = trim(joinText(items), options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS);
      const wallTime = ((performance.now() - startedAt) / 1000).toFixed(1);
      const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${wallTime} seconds\nOutput:\n`;
      return {
        content: [{ type: "text", text: header + text }],
        details: { calls },
        ...(result.ok ? {} : { isError: true }),
        ...(hooks.ends?.() ? { terminate: true } : {}),
      };
    },
  };
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

function preview(args: unknown): string {
  try {
    return args === undefined ? "" : truncate(JSON.stringify(args) ?? "", ARGS_PREVIEW_CHARS);
  } catch {
    return "";
  }
}

/** Like the script's `text()`: strings as they are, other values as compact JSON. */
const valueText = (value: unknown) => (typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)));

/**
 * Lay out the output as pi does, so the model can tell items apart: with more than one text item each
 * starts with `==> text N/M <==`, and `console.*` lines follow in one `<console_output>` block. Sprockets have
 * no image capabilities, so an `image()` item becomes a note.
 */
function formatOutput(output: CodemodeOutputItem[]): string[] {
  const texts = output.filter((item) => item.type === "text" && !item.console);
  const items: string[] = [];
  const consoleLines: string[] = [];
  let index = 0;
  for (const item of output) {
    if (item.type === "image") items.push("[image() isn't supported here: the image was left out]");
    else if (item.console) consoleLines.push(item.text);
    else items.push(texts.length > 1 ? `==> text ${++index}/${texts.length} <==\n${item.text}` : item.text);
  }
  if (consoleLines.length) items.push(`<console_output>\n${consoleLines.join("\n")}\n</console_output>`);
  return items;
}

/** Items joined, each starting on its own line. */
function joinText(items: string[]): string {
  let out = "";
  for (const item of items) out += (out && !out.endsWith("\n") ? "\n" : "") + item;
  return out;
}

function formatError(result: Extract<CodemodeResult, { ok: false }>, calls: CallRecord[]): string {
  const { error } = result;
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`;
  const made = calls.length
    ? `Tool calls made before the failure (they are not undone): ${calls.map((c) => `${c.name} (${c.status})`).join(", ")}`
    : "No tool calls were made.";
  return `${head}\n\n${made}`;
}

/** Keep the start and end of output over the token budget, as pi does (without a file to read the rest from). */
function trim(text: string, maxTokens: number): string {
  const budget = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= budget) return text;
  const head = Math.floor(budget / 2);
  const tail = budget - head;
  const removed = text.length - head - tail;
  return `Warning: truncated output (original token count: ${Math.ceil(text.length / CHARS_PER_TOKEN)})\nTotal output lines: ${text.split("\n").length}\n\n${text.slice(0, head)}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail > 0 ? text.slice(-tail) : ""}\n\n[Narrow the script's output to see the rest: filter it in the script, or return less.]`;
}
