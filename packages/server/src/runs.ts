// Sprocket runs (ADR 0006): when the user writes to a Sprocket, one bounded agent run writes its reply.
// Nothing runs while nobody writes: idle Sprockets cost nothing. Runs are capped (steps per run, runs per
// hour) so a bug can't loop and burn the user's provider quota; spending itself is the user's to manage.
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Api, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import { CORE_MEMORY_MAX } from "@rails/shared";
import { projects, settings, sprocketMessages, sprockets } from "./db.ts";
import { findModel, models } from "./models.ts";

/** Model calls in one run (each round of tool calls is one). */
const MAX_STEPS = 12;
const MAX_RUNS_PER_HOUR = 30;
/** Runs at once, across all Sprockets. */
const MAX_ACTIVE = 2;
/** Chat messages sent with each run. */
const HISTORY = 40;
/** How often a reply in progress is sent to browsers. */
const TYPING_MS = 120;

const running = new Set<string>();
/** Sprockets that got new messages while their run was going: they reply again afterwards. */
const again = new Set<string>();
const waiting: string[] = [];
const recent = new Map<string, number[]>();
/** When each running Sprocket's run started (ms). Its reply is dated then. */
const runStart = new Map<string, number>();

const changeListeners = new Set<() => void>();
const typingListeners = new Set<(sprocketId: string, text: string | null) => void>();
/** Something visible changed: a run started or ended, a message or the core memory was written. */
export const onRunsChanged = (fn: () => void) => changeListeners.add(fn);
export const onTyping = (fn: (sprocketId: string, text: string | null) => void) => typingListeners.add(fn);
const changed = () => changeListeners.forEach((fn) => fn());
const typing = (id: string, text: string | null) => typingListeners.forEach((fn) => fn(id, text));

export const isRunning = (sprocketId: string) => running.has(sprocketId);

/**
 * The date for a new user message: after the start of a run that's going, so that run's reply (dated at
 * its start) comes before it, and the message gets a run of its own.
 */
export function userMessageTime(sprocketId: string): string {
  return new Date(Math.max(Date.now(), (runStart.get(sprocketId) ?? 0) + 1)).toISOString();
}

/** Ask a Sprocket to reply to its chat. Safe to call repeatedly: requests coalesce. */
export function requestReply(sprocketId: string): void {
  if (running.has(sprocketId)) again.add(sprocketId);
  else if (running.size >= MAX_ACTIVE) {
    if (!waiting.includes(sprocketId)) waiting.push(sprocketId);
  } else void start(sprocketId);
}

/** Resolves once every run has finished (for tests and shutdown). */
export async function idle(): Promise<void> {
  while (running.size || waiting.length) await new Promise((r) => setTimeout(r, 10));
}

async function start(id: string) {
  running.add(id);
  changed();
  try {
    await run(id);
  } catch (e) {
    notice(id, `Something went wrong: ${(e as Error).message}`);
  } finally {
    running.delete(id);
    runStart.delete(id);
    typing(id, null);
    changed();
    if (again.delete(id)) requestReply(id);
    const next = waiting.shift();
    if (next) requestReply(next);
  }
}

function notice(sprocketId: string, text: string) {
  if (sprockets.get(sprocketId)) sprocketMessages.create(sprocketId, "notice", text);
}

/** False (and a notice) when this Sprocket has run too often in the last hour. */
function underRateLimit(id: string): boolean {
  const now = Date.now();
  const times = (recent.get(id) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= MAX_RUNS_PER_HOUR) {
    notice(id, `Paused: more than ${MAX_RUNS_PER_HOUR} replies in the last hour. Try again in a little while.`);
    return false;
  }
  recent.set(id, [...times, now]);
  return true;
}

async function run(id: string) {
  const s = sprockets.get(id);
  if (!s) return;
  const history = sprocketMessages.list(id).filter((m) => m.author !== "notice");
  const last = history.at(-1);
  if (last?.author !== "user") return; // nothing new to answer
  // The reply is dated when the run starts, right after the messages it saw; messages sent meanwhile are
  // dated after it (userMessageTime) and get their own run.
  const start = Math.max(Date.now(), Date.parse(last.createdAt) + 1);
  runStart.set(id, start);
  const startedAt = new Date(start).toISOString();
  const ref = s.model ?? settings.get("defaultModel");
  const model = findModel(ref);
  if (!model) {
    notice(id, ref ? `The model ${ref} isn't available. Check its provider in Customize → Models.` : "Pick a model first: set up a provider in Customize → Models.");
    return;
  }
  if (!underRateLimit(id)) return;

  const project = s.projectId ? projects.get(s.projectId) : undefined;
  const agent = new Agent({
    initialState: {
      systemPrompt: systemPrompt(s.name, project?.name, s.coreMemory),
      model,
      tools: [rememberTool(id)],
      messages: history.slice(-HISTORY).map((m) => toLlm(m.author, m.text, model, Date.parse(m.createdAt))),
    },
    streamFn: models.streamSimple.bind(models),
    sessionId: id,
  });

  let steps = 0;
  let lastTyping = 0;
  agent.subscribe((e) => {
    if (e.type === "turn_start" && ++steps > MAX_STEPS) agent.abort();
    if (e.type === "message_update" && Date.now() - lastTyping > TYPING_MS) {
      lastTyping = Date.now();
      typing(id, textOf(e.message as AssistantMessage));
    }
  });
  await agent.continue();

  // Deleted, or moved to another project, while replying: that chat is gone, so drop the reply.
  const now = sprockets.get(id);
  if (!now || now.projectId !== s.projectId) return;
  const reply = agent.state.messages.filter((m): m is AssistantMessage => m.role === "assistant").at(-1);
  const text = reply ? textOf(reply) : "";
  if (text) sprocketMessages.create(id, "sprocket", text, startedAt);
  if (steps > MAX_STEPS) notice(id, `Stopped after ${MAX_STEPS} steps.`);
  else if (reply?.stopReason === "error") notice(id, `The model returned an error: ${readableError(reply.errorMessage)}`);
  else if (!text) notice(id, "The model sent an empty reply.");
}

/** Provider errors often embed a JSON body; show its message, not the JSON. */
export function readableError(raw: string | undefined): string {
  if (!raw) return "unknown error";
  const status = raw.match(/\b([45]\d\d)\b/)?.[1];
  const message = raw.match(/"(?:message|detail)"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const text = message ? (status ? `${status} ${message}` : message) : raw;
  return text.length > 300 ? text.slice(0, 300) + "…" : text;
}

const textOf = (m: AssistantMessage) =>
  m.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

/** A stored chat message as the model sees it. Earlier replies count as this model's own. */
function toLlm(author: "user" | "sprocket" | "notice", text: string, model: Model<Api>, timestamp: number): Message {
  if (author === "user") return { role: "user", content: text, timestamp };
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp,
  } as AssistantMessage;
}

export function systemPrompt(name: string, projectName: string | undefined, coreMemory: string): string {
  return [
    `You are ${name}, a Sprocket: a small always-on helper inside Rails. Rails runs coding agents (Claude Code, Codex and pi) in terminal panels, grouped by project, and Sprockets help the user keep track of that work.`,
    projectName
      ? `You're attached to the project "${projectName}". You can't see its sessions, files or git yet; that's coming in a later update, so don't claim to.`
      : "You aren't attached to a project, so you're simply chatting with your user.",
    "Keep replies short and plain: this is a chat, not a document. Use Markdown only for code.",
    "",
    `Your core memory stays with you, even when you move to another project (${coreMemory.length}/${CORE_MEMORY_MAX} characters used):`,
    "<core_memory>",
    coreMemory || "(empty)",
    "</core_memory>",
    "Use the remember tool to keep durable facts about your user: preferences, how they like to work, standing instructions. Never store secrets, code or details of one project there. This copy is from the start of the conversation; the tool's result shows the current sheet.",
  ].join("\n");
}

const rememberParams = Type.Object({
  op: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("rewrite")]),
  text: Type.String(),
  old: Type.Optional(Type.String()),
});

/** Edits the Sprocket's core memory, within CORE_MEMORY_MAX. */
export function rememberTool(sprocketId: string): AgentTool<typeof rememberParams> {
  return {
    name: "remember",
    label: "Remember",
    description:
      `Edit your core memory (at most ${CORE_MEMORY_MAX} characters). op "add" appends a line, "replace" swaps the exact text \`old\` for \`text\` (use an empty \`text\` to delete), "rewrite" replaces the whole sheet with \`text\` (use it to make room).`,
    parameters: rememberParams,
    execute: async (_id, params) => {
      const current = sprockets.get(sprocketId)?.coreMemory ?? "";
      const next = editMemory(current, params);
      sprockets.setCoreMemory(sprocketId, next);
      changed();
      return { content: [{ type: "text", text: `Core memory now (${next.length}/${CORE_MEMORY_MAX}):\n${next || "(empty)"}` }], details: {} };
    },
  };
}

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
