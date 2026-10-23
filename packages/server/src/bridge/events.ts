// What happens in an agent session, in one shape for all three agents (step 2 of Sprockets, ADR 0007).
// Each agent reports in its own words (Claude Code hooks, the pi extension, Codex app-server
// notifications); these pure functions turn those reports into SessionEvents. Unknown reports become
// nothing: agents add events over time, and the board only needs these.
import { isAbsolute, join } from "node:path";
import type { SessionQuestion } from "@rails/shared";

export type SessionEvent =
  /**
   * The agent started (or resumed) a session. `inbox` is Claude Code's message socket, for step 3. `from`: the panel
   * moved to this session from that one (Codex's `/new`, `/fork`, `/resume`), which is over for it.
   */
  | { kind: "start"; sessionId?: string; inbox?: string; from?: string }
  /** The user (or something on their behalf) sent a prompt. */
  | { kind: "prompt"; text: string }
  /** The agent used a tool. `files` are absolute paths it read or changed; `command` a shell command. */
  | { kind: "tool"; tool: string; files: string[]; edit: boolean; command?: string }
  /**
   * The agent is waiting for the user: a permission, a question, a form. `questions` when it asked in a dialog;
   * `detail` what a permission is for, when the agent says (the command, the file), in a line or two.
   */
  | { kind: "waiting"; reason: string; questions?: SessionQuestion[]; detail?: string; dialog?: DialogRef }
  /** The wait is over (answered or dismissed). */
  | { kind: "resumed" }
  /** The agent finished its turn. `text` is its last message. */
  | { kind: "turn_end"; text: string }
  /** The user stopped the turn before it finished (Escape): it's idle, but nothing was finished. */
  | { kind: "stopped" }
  /** The turn failed. */
  | { kind: "failed"; error: string }
  /** The session ended (the agent quit). */
  | { kind: "ended" };

/**
 * A question Rails can answer (ADR 0027): its id, and what it takes. In pi, from the Rails extension: pi's own
 * select (one of `options`) and input (any text), or a questionnaire from an extension with an answer contract (an
 * option of the questions Rails read from the tool's input, or text). In Codex, `steer`: a question it asked while
 * its turn goes on, answered by steering that turn (the id is the turn's) with the text.
 */
export interface DialogRef {
  id: string;
  /** `claude`: Claude Code's question dialog, answered through Rails' mod by the tool call's id (ADR 0028). */
  kind: "select" | "input" | "questionnaire" | "steer" | "claude";
  options?: string[];
}

function dialogOf(v: any): DialogRef | undefined {
  if (typeof v?.id !== "string" || !v.id || !["select", "input", "questionnaire"].includes(v.kind)) return undefined; // pi's kinds
  const options = Array.isArray(v.options) ? v.options.filter((o: unknown) => typeof o === "string").slice(0, 50).map((o: string) => clip(o, 200)) : undefined;
  return { id: v.id.slice(0, 200), kind: v.kind, ...(v.kind === "select" ? { options: options ?? [] } : {}) };
}

/** Waits without questions that still ask the user something: a Claude Code MCP form, Codex's request for input. */
export const ASKING = new Set(["a form", "input"]);

/** Longest text kept from a prompt or a final message. Agents report what they like, so every field is bounded. */
const MAX_TEXT = 2000;
/** Most files kept from one tool use. */
export const MAX_FILES = 20;
const clip = (s: unknown, max = MAX_TEXT) => {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) + "…" : t;
};
/** A final message keeps its start and its end: a closing question is what says the session waits for the user. */
const HEAD = 500;
const clipEnds = (s: unknown) => {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > MAX_TEXT ? `${t.slice(0, HEAD)}\n…\n${t.slice(t.length - (MAX_TEXT - HEAD))}` : t;
};

/**
 * The questions in a tool's input, by its shape, not the tool's name: a list (`{questions: [{question,
 * options}]}`, as Claude Code's AskUserQuestion and pi's rpiv-ask-user-question take) or one question
 * (`{question, options | choices}`). Options are strings or `{label | value | title}`. A question without
 * options is open: it's answered by typing. Bounded, like everything agents report.
 */
function questionsOf(input: any): SessionQuestion[] | undefined {
  const raw: any[] = Array.isArray(input?.questions) ? input.questions : typeof input?.question === "string" ? [input] : [];
  const label = (o: any) => clip(typeof o === "string" ? o : (o?.label ?? o?.value ?? o?.title), 100);
  const list = raw
    .slice(0, 4)
    .map((q) => {
      const options = Array.isArray(q?.options) ? q.options : Array.isArray(q?.choices) ? q.choices : [];
      return { question: clip(q?.question, 300), options: options.slice(0, 6).map(label).filter(Boolean) };
    })
    .filter((q) => q.question);
  return list.length ? list : undefined;
}
const abs = (cwd: string | undefined, p: unknown) => (typeof p !== "string" || !p ? [] : [clip(isAbsolute(p) || !cwd ? p : join(cwd, p), 500)]);
const id = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);

// ---- Claude Code: hook name + hook input (code.claude.com/docs/en/hooks) ----

const CLAUDE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function fromClaude(hook: string, input: any, extra: { inbox?: string } = {}): SessionEvent[] {
  const cwd = typeof input?.cwd === "string" ? input.cwd : undefined;
  switch (hook) {
    case "SessionStart":
      return [{ kind: "start", sessionId: id(input?.session_id), ...(extra.inbox ? { inbox: extra.inbox } : {}) }];
    case "UserPromptSubmit":
      return [{ kind: "prompt", text: clip(input?.prompt) }];
    case "PreToolUse":
      // Only questions to the user reach here (the hook matcher), and they wait for an answer.
      if (input?.tool_name !== "AskUserQuestion") return [];
      const questions = questionsOf(input?.tool_input);
      return [{ kind: "waiting", reason: "question", ...(questions ? { questions } : {}) }];
    case "PostToolUse": {
      const tool = clip(input?.tool_name, 100) || "tool";
      const ti = input?.tool_input ?? {};
      return [
        {
          kind: "tool",
          tool,
          files: [...abs(cwd, ti.file_path), ...abs(cwd, ti.notebook_path), ...abs(cwd, ti.path)].slice(0, MAX_FILES),
          edit: CLAUDE_EDIT_TOOLS.has(tool),
          ...(tool === "Bash" && typeof ti.command === "string" ? { command: clip(ti.command, 200) } : {}),
        },
      ];
    }
    case "dialog": {
      // Rails' mod (ADR 0028): Claude's question dialog is open and can be answered from Rails, by this id.
      const id = typeof input?.id === "string" && input.id ? input.id.slice(0, 200) : undefined;
      const options = (Array.isArray(input?.options) ? input.options : []).slice(0, 20).map((o: unknown) => clip(o, 200)).filter(Boolean);
      const question = clip(input?.question, 500);
      if (!id || !question) return [];
      return [{ kind: "waiting", reason: "question", questions: [{ question, options }], dialog: { id, kind: "claude", options } }];
    }
    case "PermissionRequest": {
      const tool = clip(input?.tool_name, 100) || "a tool";
      const detail = toolDetail(tool, input?.tool_input);
      return [{ kind: "waiting", reason: `permission for ${tool}`, ...(detail ? { detail } : {}) }];
    }
    case "Notification":
      // Forms from MCP servers wait for the user; other notifications (idle reminders, auth) don't.
      return /^elicitation(_url)?_dialog$/.test(input?.notification_type ?? "") ? [{ kind: "waiting", reason: "a form" }] : [];
    case "Stop":
      return [{ kind: "turn_end", text: clipEnds(input?.last_assistant_message) }];
    case "StopFailure":
      return [{ kind: "failed", error: clip(input?.error ?? input?.message ?? input?.error_type ?? "the turn failed", 300) }];
    case "SessionEnd":
      return [{ kind: "ended" }];
    default:
      return [];
  }
}

// ---- pi: events posted by the Rails pi extension (bridge/pi/rails.ts) ----

const PI_EDIT_TOOLS = new Set(["edit", "write"]);

export function fromPi(event: string, data: any): SessionEvent[] {
  const cwd = typeof data?.cwd === "string" ? data.cwd : undefined;
  switch (event) {
    case "session_start":
      return [{ kind: "start", sessionId: id(data?.sessionId) }];
    case "prompt":
      return data?.text ? [{ kind: "prompt", text: clip(data.text) }] : [];
    case "tool": {
      const tool = clip(data?.tool, 100) || "tool";
      const input = data?.input ?? {};
      return [
        {
          kind: "tool",
          tool,
          files: abs(cwd, input.path),
          // The call (`started`) isn't the change: the extension reports an edit again once it worked (ADR 0014).
          // Extensions from before that report only the call.
          edit: PI_EDIT_TOOLS.has(tool) && !data?.started,
          ...(tool === "bash" && typeof input.command === "string" ? { command: clip(input.command, 200) } : {}),
        },
      ];
    }
    case "ui_prompt_start": {
      // A dialog opened. If a tool whose input holds questions was running (the extension sends its input),
      // it's that question for the user; otherwise it's some extension's dialog, which may be an approval.
      const questions = questionsOf(data?.input);
      const dialog = dialogOf(data?.dialog);
      if (questions) return [{ kind: "waiting", reason: "question", questions, ...(dialog ? { dialog } : {}) }];
      // The tool that was running when it opened (the extension sends it): what an approval would be for.
      const during = data?.during?.tool ? toolDetail(clip(data.during.tool, 100), data.during.input, "While running") : "";
      return [{ kind: "waiting", reason: data?.title ? clip(data.title, 120) : "a prompt", ...(during ? { detail: during } : {}), ...(dialog ? { dialog } : {}) }];
    }
    case "ui_prompt_end":
      return [{ kind: "resumed" }];
    case "agent_end":
      if (data?.aborted) return [{ kind: "stopped" }];
      return data?.error ? [{ kind: "failed", error: clip(data.error, 300) }] : [{ kind: "turn_end", text: clipEnds(data?.text) }];
    case "session_shutdown":
      return [{ kind: "ended" }];
    default:
      return [];
  }
}

// ---- Codex: app-server notifications for one thread (codex app-server generate-json-schema) ----

export function fromCodex(method: string, params: any): SessionEvent[] {
  switch (method) {
    case "thread/status/changed": {
      const s = params?.status;
      const flags: string[] = s?.activeFlags ?? [];
      if (flags.includes("waitingOnApproval")) return [{ kind: "waiting", reason: "approval" }];
      if (flags.includes("waitingOnUserInput")) return [{ kind: "waiting", reason: "input" }];
      if (s?.type === "systemError") return [{ kind: "failed", error: "Codex reported a system error" }];
      return s?.type === "active" ? [{ kind: "resumed" }] : [];
    }
    case "item/completed": {
      const item = params?.item ?? {};
      // A question Codex asks while its turn goes on ("? 1 question" in its panel): it waits for the answer, steered
      // into the turn, and may keep working meanwhile (verified with 0.163).
      if (item.type === "agentMessage" && item.delivery === "async" && Array.isArray(item.questions) && item.questions.length) {
        const questions = item.questions.slice(0, 10).map((q: any) => ({
          question: clip(q?.title ?? q?.question, 500),
          options: (Array.isArray(q?.options) ? q.options : []).slice(0, 20).map((o: any) => clip(typeof o === "string" ? o : (o?.label ?? ""), 200)).filter(Boolean),
        }));
        const turnId = typeof params?.turnId === "string" ? params.turnId : undefined;
        return [{ kind: "waiting", reason: "question", questions, ...(turnId ? { dialog: { id: turnId, kind: "steer", options: questions[0].options } } : {}) }];
      }
      if (item.type === "userMessage") {
        const text = (item.content ?? []).map((c: any) => (c?.type === "text" ? c.text : "")).join("\n");
        return text.trim() ? [{ kind: "prompt", text: clip(text) }] : [];
      }
      if (item.type === "commandExecution") return [{ kind: "tool", tool: "shell", files: [], edit: false, command: clip(item.command, 200) }];
      if (item.type === "fileChange") {
        // A patch that failed or was declined changed nothing.
        const edit = item.status !== "failed" && item.status !== "declined";
        return [{ kind: "tool", tool: "apply_patch", files: (item.changes ?? []).flatMap((c: any) => abs(undefined, c?.path)).slice(0, MAX_FILES), edit }];
      }
      return [];
    }
    case "turn/completed": {
      const turn = params?.turn ?? {};
      if (turn.status === "failed") return [{ kind: "failed", error: clip(turn.error?.message ?? "the turn failed", 300) }];
      if (turn.status === "interrupted") return [{ kind: "stopped" }];
      const final = [...(turn.items ?? [])].reverse().find((i: any) => i?.type === "agentMessage");
      return [{ kind: "turn_end", text: clipEnds(final?.text) }];
    }
    case "thread/closed":
      return [{ kind: "ended" }];
    // Approvals the daemon asks its clients for (requests with an id; the panel answers them, never Rails),
    // with what they're for. `thread/status/changed` has already said it waits for one.
    case "item/commandExecution/requestApproval": {
      const shown = params?.commandActions?.find?.((a: any) => typeof a?.command === "string")?.command ?? params?.command;
      return [{ kind: "waiting", reason: "approval", detail: reasoned(`Run: ${clip(shown, 300)}`, params?.reason) }];
    }
    case "item/fileChange/requestApproval":
      return [{ kind: "waiting", reason: "approval", detail: reasoned(params?.grantRoot ? `Change files, and write under ${clip(params.grantRoot, 200)}` : "Change files", params?.reason) }];
    case "item/permissions/requestApproval":
      return [{ kind: "waiting", reason: "approval", detail: reasoned(`More permissions: ${clip(JSON.stringify(params?.permissions ?? {}), 300)}`, params?.reason) }];
    default:
      return [];
  }
}

const reasoned = (what: string, reason: unknown) => (clip(reason, 300) ? `${what}\nIts reason: ${clip(reason, 300)}` : what);

/** What a tool call is for, in a line: its command, file or address, else its input. */
function toolDetail(tool: string, input: any, lead = "Use"): string {
  if (!input || typeof input !== "object") return tool === "a tool" ? "" : `${lead} ${tool}`;
  const one = [input.command, input.file_path, input.path, input.notebook_path, input.url].find((v) => typeof v === "string" && v.trim());
  const what = one ? clip(one, 300) : clip(JSON.stringify(input), 300);
  const why = typeof input.description === "string" && input.description.trim() ? ` (${clip(input.description, 150)})` : "";
  return `${lead} ${tool}: ${what}${why}`;
}

// ---- shell commands, for the files they change (shellEdits.ts, ADR 0016) ----

/** A shell command starting or ending in a session, by the agent's id for that call. */
export interface ShellCall {
  phase: "start" | "end";
  id: string;
  /** At the start, the command line, when the agent says (to tell commands that only read). */
  command?: string;
}

/** Whether a report is a shell command starting or ending: Claude Code's Bash, pi's bash, Codex's commands. */
export function shellCall(source: string, name: string, body: any): ShellCall | undefined {
  const call = (phase: ShellCall["phase"], v: unknown, command?: unknown): ShellCall | undefined =>
    typeof v === "string" && v ? { phase, id: v.slice(0, 200), ...(typeof command === "string" && command ? { command: command.slice(0, 4000) } : {}) } : undefined;
  if (source === "claude" && body?.tool_name === "Bash") {
    if (name === "PreToolUse") return call("start", body.tool_use_id, body.tool_input?.command);
    if (name === "PostToolUse") return call("end", body.tool_use_id);
  }
  if (source === "pi") {
    if (name === "tool" && body?.tool === "bash" && body?.started) return call("start", body.id, body.input?.command);
    if (name === "tool_end") return call("end", body?.id);
  }
  if (source === "codex" && body?.item?.type === "commandExecution") {
    if (name === "item/started") return call("start", body.item.id, body.item.command);
    if (name === "item/completed") return call("end", body.item.id);
  }
  return undefined;
}
