// Sprocket runs (ADR 0006, 0023): when the user writes to a Sprocket, a teammate passes it the turn, or Rails wakes a
// Coordinator because a session waits for the user (watches.ts), one bounded agent run takes that turn. Runs are
// rows (`sprocket_runs`): queued, then running, then done, failed, cancelled or waiting (for the user's answer to
// a question with options). Nothing runs otherwise: idle Sprockets cost nothing. Runs are capped (steps per run,
// runs per hour) so a bug can't loop and burn the user's provider quota; spending itself is the user's to manage.
// A provider failure that may pass (a dropped connection, a busy provider, a request it never answered) is tried
// once more.
import { Agent } from "@earendil-works/pi-agent-core";
import { isRetryableAssistantError, type AssistantMessage, type Message, type Model } from "@earendil-works/pi-ai";
import { CARD_ACTIONS_MAX, TEAM_TURNS_MAX, actionSettled, cardText, type SprocketCard, type SprocketCardAction, type SprocketMessage } from "@rails/shared";
import {
  automationRuns,
  handoffs,
  panels,
  projects,
  settings,
  sprocketChats,
  sprocketMessages,
  sprocketRuns,
  sprocketTools,
  sprockets,
  suggestions,
  usage,
  type RunStatus,
  type RunTrigger,
  type StoredChat,
  type StoredRun,
} from "./db.ts";
import { stepText, summarize, type Capability } from "./harness/capabilities.ts";
import { projectChatCapability } from "./harness/chats.ts";
import { codemodeTool, type CallRecord } from "./harness/codemode.ts";
import { memoryCapability } from "./harness/memory.ts";
import { projectCapabilities } from "./harness/project.ts";
import { promptsCapability } from "./harness/prompts.ts";
import { replyCapabilities } from "./harness/reply.ts";
import { showCardCapability } from "./harness/cards.ts";
import { mcpCapabilities, type Proposal } from "./harness/mcpTools.ts";
import { readSkillCapability, skillsPrompt } from "./harness/skills.ts";
import { listSkills } from "./skills.ts";
import { serversFor } from "./mcp.ts";
import { askUserCapability, nothingNewCapability, passTurnCapability, sendMessageCapability, type TurnEnd } from "./harness/turns.ts";
import { findModel, models } from "./models.ts";
import { projectOwners } from "./owners.ts";
import { resendWhenSilent } from "./resend.ts";
import { sessionTitle } from "./titles.ts";
import { handOnNudge, nudge, roundNow, severalEvents, systemPrompt, TEXTING_NOW, toLlm, whyNow } from "./prompt.ts";
import { askedTeammates, handOn, inRound, notYet, queuedIn, teamInfo, waitingAsks, type TeamInfo } from "./rounds.ts";
import { listeners } from "./util.ts";

/** Model calls in one run (each round of tool calls is one). */
const MAX_STEPS = 12;
const MAX_RUNS_PER_HOUR = 30;
/** Runs at once, across all Sprockets. */
const MAX_ACTIVE = 2;
/** Chat messages sent with each run. */
const HISTORY = 40;
/**
 * Recent replies whose tool calls and results go back to the model with them, so it knows what it looked at
 * (without them it sees answers with nothing behind them and doubts its own earlier work). Each result is
 * trimmed when it's saved.
 */
const REPLAYED = 3;
const STEP_RESULT_CHARS = 6000;
/** How often a reply in progress is sent to browsers. */
const TYPING_MS = 120;
/**
 * How long a provider gets to start answering a request: the OpenAI and Anthropic SDKs (and Mistral's) stop
 * waiting once the reply starts, so a long reply isn't cut; Google's ignores it. Unset, a request that hung waited
 * 5 minutes for Node's own limit.
 */
export const REQUEST_TIMEOUT_MS = 90_000;
/**
 * How long a provider gets to start answering before the request is sent again (resend.ts): it answers in a few
 * seconds, but now and then a request hears nothing at all.
 */
const FIRST_ANSWER_MS = 20_000;
/**
 * The wait before trying the model again after a provider failure that may pass (pi-ai tells which). The run keeps
 * its place among the MAX_ACTIVE meanwhile, so it's short.
 */
export const RETRY_MS = 15_000;

/** Runs going now, by id: their Sprocket and chat (the rows say `running`). */
const going = new Map<string, { sprocketId: string; chatId: string }>();
/** When each Sprocket ran in the last hour (the limit is per Sprocket, across its chats). */
const recent = new Map<string, number[]>();
/** When the run in each chat started (ms). A project chat's reply is dated then. */
const runStart = new Map<string, number>();

const runChanges = listeners();
const typingChanges = listeners<[sprocketId: string, chatId: string, text: string | null]>();
const activityChanges = listeners<[sprocketId: string, chatId: string, step: string | null, summary: string | null]>();
/** Something visible changed: a run was queued, started or ended, a message or the core memory was written. */
export const onRunsChanged = runChanges.on;
export const onTyping = typingChanges.on;
/** The step a reply is on and what it has done so far (the run log); nulls when the run ends. */
export const onActivity = activityChanges.on;
const changed = runChanges.emit;
/** Tell browsers a chat changed (a message was updated outside a run, as an approval decided). */
export const runsChanged = changed;
const typing = typingChanges.emit;

/** Whether a Sprocket has a run going (in any chat). A Sprocket answers one chat at a time (ADR 0021). */
export const isRunning = (sprocketId: string) => [...going.values()].some((g) => g.sprocketId === sprocketId);
/** The chat a Sprocket is replying in, if it is. */
export const runningChat = (sprocketId: string) => [...going.values()].find((g) => g.sprocketId === sprocketId)?.chatId;

/** Who's on it in a chat: the Sprocket replying, those queued (in order) and those waiting for the user's answer. */
export function chatTurns(chatId: string): { replying?: string; queued: string[]; waiting: string[] } {
  const replying = [...going.values()].find((g) => g.chatId === chatId)?.sprocketId;
  return {
    ...(replying ? { replying } : {}),
    queued: sprocketRuns.list(["queued"], chatId).map((r) => r.sprocketId),
    waiting: sprocketRuns.list(["waiting"], chatId).map((r) => r.sprocketId),
  };
}

/**
 * The date for a new message from the user or Rails: after the start of a run that's going, so that run's reply
 * (dated at its start) comes before it, and the message gets a run of its own; and after the chat's last message,
 * which quick replies in a row can date a little ahead of the clock.
 */
export function userMessageTime(chatId: string): string {
  const last = sprocketMessages.last(chatId);
  return new Date(Math.max(Date.now(), (runStart.get(chatId) ?? 0) + 1, last ? Date.parse(last.createdAt) + 1 : 0)).toISOString();
}

/** The date for a message a run posts as it goes: now, after the chat's last message. */
function postTime(chatId: string): string {
  const last = sprocketMessages.last(chatId);
  return new Date(Math.max(Date.now(), last ? Date.parse(last.createdAt) + 1 : 0)).toISOString();
}

/**
 * Queue a run for a chat's Sprocket (in a team, the member `sprocketId`). A run already queued for it there is
 * enough: it reads everything new when it starts, so repeated requests (a burst of events) coalesce.
 */
export function requestReply(
  chatId: string,
  sprocketId?: string,
  { trigger = "user", sourceId, from, hop = 0 }: { trigger?: RunTrigger; sourceId?: string; from?: string; hop?: number } = {},
): void {
  const chat = sprocketChats.get(chatId);
  if (!chat) return;
  const who = sprocketId ?? chat.sprocketId;
  if (!sprocketRuns.list(["queued"], chatId).some((r) => r.sprocketId === who)) sprocketRuns.create({ chatId, sprocketId: who, trigger, sourceId, from, hop });
  changed();
  pump();
}

/**
 * Queue an automation's run (ADR 0032) in its Sprocket's direct chat, for the line `lineId` it posted there. Unlike
 * requestReply it doesn't fold into a run already queued: the automation tracks this run. Returns its id. It doesn't
 * start until `startQueued()`, so the automation can record it in the same transaction first.
 */
export function queueAutomationRun(chatId: string, sprocketId: string, lineId: string): string {
  return sprocketRuns.create({ chatId, sprocketId, trigger: "automation", sourceId: lineId }).id;
}

/** Start the runs that are queued, and say runs changed. */
export function startQueued(): void {
  changed();
  pump();
}

/** Cancel a chat's queued runs, and with `waiting` its questions waiting for an answer too. */
export function cancelRuns(chatId: string, { waiting = false }: { waiting?: boolean } = {}): void {
  if (sprocketRuns.cancel(chatId, waiting ? ["queued", "waiting"] : ["queued"])) changed();
}

/**
 * The user answered (or wrote past) questions waiting in a chat: those runs are done, and each question records
 * `answer` when it went to its asker (`to`, all by default). Returns the Sprockets that asked, in order.
 */
export function answerWaiting(chatId: string, answer: string, to?: string[]): string[] {
  const asked: string[] = [];
  for (const r of sprocketRuns.list(["waiting"], chatId)) {
    if (to && !to.includes(r.sprocketId)) continue;
    sprocketRuns.setStatus(r.id, "done");
    const question = sprocketMessages.askOf(r.id);
    if (question) sprocketMessages.answer(question.id, answer);
    if (!asked.includes(r.sprocketId)) asked.push(r.sprocketId);
  }
  if (asked.length) changed();
  return asked;
}

/**
 * Start queued runs, oldest first, while fewer than MAX_ACTIVE go: one at a time per Sprocket and per chat, and in
 * each chat in order (a later run waits for an earlier one that can't start yet).
 */
function pump(): void {
  const held = new Set<string>();
  for (const r of sprocketRuns.list(["queued"])) {
    if (going.size >= MAX_ACTIVE) return;
    const chat = sprocketChats.get(r.chatId);
    if (!chat || !sprockets.get(r.sprocketId)) {
      sprocketRuns.setStatus(r.id, "cancelled");
      continue;
    }
    if (held.has(r.chatId) || isRunning(r.sprocketId) || [...going.values()].some((g) => g.chatId === r.chatId)) {
      held.add(r.chatId);
      continue;
    }
    void start(r, chat);
  }
}

/** Resolves once no run is going or queued (for tests and shutdown). */
export async function idle(): Promise<void> {
  while (going.size || sprocketRuns.list(["queued"]).length) await new Promise((r) => setTimeout(r, 10));
}

/** When the server starts: runs the last one was in the middle of failed (their chats say so), and queued ones start. */
export function resumeRuns(): void {
  for (const r of sprocketRuns.list(["running"])) {
    sprocketRuns.setStatus(r.id, "failed", "Rails restarted");
    const name = sprockets.get(r.sprocketId)?.name;
    if (name) notice(r.chatId, `${name} was cut off: Rails restarted while it was replying.`, r.sprocketId);
  }
  pump();
}

async function start(r: StoredRun, chat: StoredChat) {
  const { chatId, sprocketId } = r;
  going.set(r.id, { sprocketId, chatId });
  sprocketRuns.setStatus(r.id, "running");
  changed();
  let status: RunStatus = "done";
  let error: string | undefined;
  let end: { passTo: string; sourceId: string } | undefined;
  try {
    const result = await run(chat, r);
    if (result?.asked) status = "waiting";
    end = result?.passed;
  } catch (e) {
    status = "failed";
    error = (e as Error).message;
    notice(chatId, `Something went wrong: ${error}`, sprocketId);
  } finally {
    going.delete(r.id);
    runStart.delete(chatId);
    typing(sprocketId, chatId, null);
    activityChanges.emit(sprocketId, chatId, null, null);
    // Cancelled meanwhile (the chat was cleared): it stays so.
    if (sprocketRuns.get(r.id)?.status === "running") sprocketRuns.setStatus(r.id, status, error);
    if (end) requestReply(chatId, end.passTo, { trigger: "pass", sourceId: end.sourceId, from: sprocketId, hop: r.hop + 1 });
    changed();
    pump();
  }
}

/** Rails' own line in a chat; in a team, about the member `sprocketId`. */
function notice(chatId: string, text: string, sprocketId?: string) {
  if (sprocketChats.get(chatId)) sprocketMessages.create(chatId, "notice", text, userMessageTime(chatId), { sprocketId });
}

/** False (and a notice in the chat it would reply in) when this Sprocket has run too often in the last hour. */
function underRateLimit(id: string, chatId: string, name: string, team: boolean): boolean {
  const now = Date.now();
  const times = (recent.get(id) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= MAX_RUNS_PER_HOUR) {
    notice(chatId, `Paused${team ? ` ${name}` : ""}: more than ${MAX_RUNS_PER_HOUR} replies in the last hour. Try again in a little while.`, id);
    return false;
  }
  recent.set(id, [...times, now]);
  return true;
}

/** How a run ended: it asked the user (the run waits), or passed the turn (the pass line's id starts the next). */
type Outcome = { asked?: boolean; passed?: { passTo: string; sourceId: string } };

/** Take run `r`'s turn in a chat. */
async function run(chat: StoredChat, r: StoredRun): Promise<Outcome | undefined> {
  const { id: chatId } = chat;
  const id = r.sprocketId;
  const s = sprockets.get(id);
  if (!s) return;
  const team = chat.kind === "team" ? teamInfo(chat) : undefined;
  if (team && !team.members.some((m) => m.id === id)) return; // it left the team meanwhile
  // An automation's run that found nothing new left no trace in the chat (ADR 0032).
  const history = sprocketMessages.list(chatId).filter((m) => m.author !== "notice" && !m.automation?.quiet);
  const last = history.at(-1);
  // Nothing new to answer since its last run there started: from the user or an event, in a team from a teammate.
  const since = sprocketRuns.lastStart(chatId, id, r.id);
  const fresh = history.filter(
    (m) => (!since || Date.parse(m.createdAt) > Date.parse(since)) && (m.author === "user" || m.author === "event" || m.author === "automation" || (!!team && m.sprocketId !== id)),
  );
  // A decided approval (ADR 0025) or a card's settled actions (ADR 0031) are new even though no message came: the
  // Sprocket goes on with what came of them.
  if (!last || (!fresh.length && r.trigger !== "approval" && r.trigger !== "actions")) return;
  // What this run answers: everything since the last reply.
  const unanswered = history.slice(history.findLastIndex((m) => m.author === "sprocket") + 1);
  const start = Math.max(Date.now(), Date.parse(last.createdAt) + 1);
  runStart.set(chatId, start);
  const startedAt = new Date(start).toISOString();
  const ref = s.model ?? settings.get("defaultModel");
  const model = findModel(ref);
  if (!model) {
    const whose = team ? `${s.name}'s model` : "The model";
    notice(chatId, ref ? `${whose} ${ref} isn't available. Check its provider in Settings → Providers.` : `Pick a model${team ? ` for ${s.name}` : ""} first: connect a provider in Settings → Providers.`, id);
    return;
  }
  if (!underRateLimit(id, chatId, s.name, !!team)) return;

  const project = s.projectId ? projects.get(s.projectId) : undefined;
  // Who owns what in its project (ADR 0016), by the titles the user sees.
  const ownedBy = await Promise.all(
    (project ? projectOwners(project.id) : []).flatMap((o) => {
      const panel = panels.get(o.panelId);
      return panel ? [sessionTitle(panel).then((title) => ({ title, panelId: o.panelId, paths: o.paths }))] : [];
    }),
  );
  // The chat, with the tool work behind the most recent replies put back in front of them.
  const recentMessages = history.slice(-HISTORY);
  const replayed = sprocketMessages.recentSteps(chatId, id, REPLAYED);
  const context: Message[] = recentMessages.flatMap((m) => [...((replayed.get(m.id) ?? []) as Message[]), toLlm(m, model, id, team)]);
  // How to write, once more right before it does: models keep their document habits from the system prompt alone.
  // Its MCP servers (ADR 0025), outside the project chat: those never connected connect now, and one that can't is
  // named in the reminder.
  const toolbox = sprocketTools.of(id);
  const servers = chat.kind !== "project" ? await serversFor(toolbox.mcp) : [];
  // Its skills, in every chat: reading one changes nothing.
  const skills = toolbox.skills.length ? listSkills().filter((k) => toolbox.skills.includes(k.id)) : [];
  const unreachable = servers.filter((x) => x.error).map((x) => `[Rails] The MCP server ${x.server.name} can't be reached right now (${x.error}), so its tools aren't here this turn.`);
  if (chat.kind !== "project")
    context.push({ role: "user", content: [team ? `${TEXTING_NOW}\n${roundNow(history, r, team)}` : [TEXTING_NOW, ...whyNow(r)].join("\n"), ...unreachable].join("\n"), timestamp: Date.now() });
  // Events that came in together (one arrived while it answered another): models answered only the latest.
  // (An agent's drafted message doesn't wake it, and needs nothing.)
  const events = unanswered.filter((m) => m.author === "event" && m.event && m.event.what !== "message");
  if (chat.kind === "project" && events.length > 1) context.push({ role: "user", content: severalEvents(events), timestamp: Date.now() });
  // One tool (ADR 0008): the model writes scripts that call the Sprocket's capabilities. A Coordinator can
  // also suggest replies to sessions (ADR 0010), shown under the reply this run saves. Outside the project chat a
  // run can end its turn on purpose (ADR 0023): ask the user, or in a team pass the turn.
  const made: string[] = [];
  let end: TurnEnd | undefined;
  const endWith = (e: TurnEnd) => (end = e);
  const ended = () => !!end;
  /** Whether it has posted anything to its user this run (`posted` and `sent` are below). */
  const said = () => posted.size > 0 || sent.length > 0;
  const capabilities = [
    memoryCapability(changed),
    promptsCapability,
    ...(project ? projectCapabilities : []),
    // In its direct chat and its teams, the project chat's events are a call away rather than in every run (ADR 0021).
    ...(project && chat.kind !== "project" ? [projectChatCapability] : []),
    ...(project && s.coordinator ? replyCapabilities(s.rules, (sid) => made.push(sid)) : []),
    ...(chat.kind !== "project" ? [askUserCapability(endWith, ended), sendMessageCapability((text) => post(text)), showCardCapability((card) => show(card))] : []),
    ...mcpCapabilities(servers.filter((x) => !x.error).map((x) => x.server), propose),
    ...(skills.length ? [readSkillCapability(skills)] : []),
    ...(r.trigger === "automation" && chat.kind === "direct" ? [nothingNewCapability(endWith, ended, said)] : []),
    ...(team ? [passTurnCapability(team.members.filter((m) => m.id !== id), { hop: r.hop, queued: () => queuedIn(chatId), asking: () => waitingAsks(chatId).map((a) => a.sprocketId), said }, endWith, ended)] : []),
  ];
  // The run log: every call's outcome, and the ones going now (scripts can run several at once).
  const done: { name: string; args: unknown; status: CallRecord["status"] }[] = [];
  const calling: { capability: Capability; args: unknown }[] = [];
  const report = () => {
    const now = calling.at(-1);
    activityChanges.emit(id, chatId, now ? stepText(now.capability, now.args) : null, summarize(capabilities, done) ?? null);
  };
  const code = codemodeTool(capabilities, { sprocketId: id, project }, {
    store: () => sprockets.codemodeStore(id),
    // Moving to another project clears the store (it belonged there): a script that was running then mustn't put it back.
    saveStore: (writes) => sprockets.get(id)?.projectId === s.projectId && sprockets.saveCodemodeStore(id, writes),
    onCallStart: (capability, args) => {
      calling.push({ capability, args });
      report();
    },
    onCallEnd: (capability, args, status) => {
      const i = calling.findIndex((g) => g.capability === capability && g.args === args);
      if (i >= 0) calling.splice(i, 1);
      done.push({ name: capability.name, args, status });
      report();
    },
    ends: ended,
  });
  const agent = new Agent({
    initialState: {
      systemPrompt: [systemPrompt(s.name, project?.name, s.description, s.coreMemory, s.coordinator ? s.rules : undefined, s.coordinator ? handoffs.pending(s.id) : [], ownedBy, chat.kind, team && { ...team, self: id }), ...skillsPrompt(skills)].join("\n"),
      model,
      tools: [code],
      messages: context,
    },
    streamFn: resendWhenSilent((m, c, options) => models.streamSimple(m, c, { ...options, timeoutMs: REQUEST_TIMEOUT_MS }), FIRST_ANSWER_MS),
    sessionId: chatId,
  });

  const projectId = s.projectId;
  /** Deleted, moved to another project or its chat cleared (or deleted) since it started: what it answered is gone. */
  const stale = () => {
    const now = sprockets.get(id);
    const cleared = sprocketChats.get(chatId)?.clearedAt;
    return !now || now.projectId !== projectId || !sprocketChats.get(chatId) || (!!cleared && Date.parse(cleared) >= start);
  };
  /** Outside the project chat, each model message's text is posted as soon as it's written (ADR 0023), by message. */
  const live = chat.kind !== "project";
  const posted = new Map<AssistantMessage, SprocketMessage>();
  const clean = (text: string) => (team ? withoutName(text, s.name) : text);
  /** Messages it posted with send_message and the cards it showed (show_card), as it went. */
  const sent: SprocketMessage[] = [];
  /** Text it already posted this run, said again (models repeat their message after a refused pass): not posted twice. */
  const repeats = (text: string) => [...posted.values(), ...sent].some((m) => alike(m.text, clean(text)));
  const post = (text: string) => {
    if (stale() || repeats(text)) return;
    sent.push(sprocketMessages.create(chatId, "sprocket", clean(text), postTime(chatId), { sprocketId: id, runId: r.id }));
    changed();
  };
  const show = (card: SprocketCard) => {
    if (stale()) return;
    sent.push(sprocketMessages.create(chatId, "sprocket", cardText(card), postTime(chatId), { sprocketId: id, runId: r.id, card }));
    changed();
  };

  /**
   * An ask tool's call in a direct or team chat (ADR 0031): it goes on a card as an action. This run's calls share one
   * card (a new one once it's full, or once the user has settled it).
   */
  let proposals: string | undefined;
  function propose(p: Proposal): string {
    if (stale()) return "Your user wrote again meanwhile: nothing was proposed.";
    const action: SprocketCardAction = { label: labelOf(p.title), serverId: p.serverId, server: p.server, tool: p.tool, args: p.args, ...(p.destructive ? { destructive: true } : {}), status: "waiting" };
    const open = proposals ? sprocketMessages.get(proposals)?.card : undefined;
    if (proposals && open?.actions && open.actions.length < CARD_ACTIONS_MAX && !open.actions.every(actionSettled)) {
      sprocketMessages.setCardActions(proposals, [...open.actions, action]);
      changed();
    } else {
      const card: SprocketCard = { title: `Wants to use ${p.server}`, blocks: [], actions: [action] };
      const m = sprocketMessages.create(chatId, "sprocket", cardText(card), postTime(chatId), { sprocketId: id, runId: r.id, card });
      sent.push(m);
      proposals = m.id;
      changed();
    }
    return `Put on a card for your user to run or skip: ${p.server} ${p.tool} with ${JSON.stringify(p.args)}. Nothing has run yet. Your turn goes on; once your user is done with the card, you get a new turn with what came of each call. Don't say it's done.`;
  }

  /** Asked to pass the turn it forgot: what it writes now isn't posted (its message is in already). */
  let nudged = false;
  /**
   * Whether it ended its turn on its own without passing it, and may still be reminded to: it wasn't stopped, has
   * passes left, and the user hasn't written since it started.
   */
  const mayNudge = (): boolean => {
    const last = agent.state.messages.at(-1);
    if (end || stale() || steps > MAX_STEPS || r.hop >= TEAM_TURNS_MAX) return false;
    if (last?.role !== "assistant" || (last as AssistantMessage).stopReason !== "stop") return false;
    return !sprocketMessages.list(chatId).some((m) => m.author === "user" && Date.parse(m.createdAt) > start);
  };
  /** The teammates its last message asks something, when it ended its turn without passing it to anyone. */
  const unpassed = (t: TeamInfo): string[] => {
    if (!mayNudge()) return [];
    const said = [...posted.values(), ...sent].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)?.text ?? "";
    const queued = queuedIn(chatId);
    return askedTeammates(said, t.members.filter((m) => m.id !== id && !queued.includes(m.id)));
  };
  /** Teammates the message that gave it the turn left a later step for, when it passed to none of them. */
  const unhanded = (t: TeamInfo): string[] => {
    if (!mayNudge()) return [];
    const queued = queuedIn(chatId);
    const history = sprocketMessages.list(chatId);
    return [...new Set([...handOn(history, r, t), ...(inRound(r) ? notYet(history, r, t) : [])])].filter((name) => !queued.includes(t.members.find((m) => m.name === name)!.id));
  };

  let steps = 0;
  let lastTyping = 0;
  agent.subscribe((e) => {
    if (e.type === "turn_start" && ++steps > MAX_STEPS) agent.abort();
    if (e.type === "message_update" && Date.now() - lastTyping > TYPING_MS) {
      lastTyping = Date.now();
      typing(id, chatId, textOf(e.message as AssistantMessage) || "…");
    }
    if (live && !nudged && e.type === "message_end" && e.message.role === "assistant") {
      const m = e.message as AssistantMessage;
      const text = m.stopReason === "error" || m.stopReason === "aborted" ? "" : clean(textOf(m));
      if (text && !stale() && !repeats(text)) {
        posted.set(m, sprocketMessages.create(chatId, "sprocket", text, postTime(chatId), { sprocketId: id, runId: r.id }));
        changed();
      }
    }
  });
  // Where this run's own messages start in the agent's state (which also holds the system prompt).
  const before = agent.state.messages.length;
  try {
    await agent.continue();
    // Once more after a failure that may pass, from where the run was: the failed call goes, the work before it
    // stays (a script that ran isn't run again, a handoff it carried out keeps its draft). Not a usage limit.
    const failed = agent.state.messages.at(-1);
    if (failed?.role === "assistant" && isRetryableAssistantError(failed as AssistantMessage)) {
      agent.state.messages = agent.state.messages.slice(0, -1);
      activityChanges.emit(id, chatId, "Trying the model again", summarize(capabilities, done) ?? null);
      await new Promise((r) => setTimeout(r, RETRY_MS));
      if (!stale()) await agent.continue();
    }
    // A member that asked a teammate something without passing the turn: once more, to pass it or leave it (ADR 0023).
    // Or that was given the turn by a message that left a teammate a later step, and didn't pass it on.
    const asked = team ? unpassed(team) : [];
    const after = team && !asked.length ? unhanded(team) : [];
    if (asked.length || after.length) {
      nudged = true;
      const from = team!.members.find((m) => m.id === r.from)?.name ?? "A teammate";
      const everyone = !handOn(sprocketMessages.list(chatId), r, team!).length;
      agent.state.messages = [...agent.state.messages, { role: "user", content: asked.length ? nudge(asked) : handOnNudge(everyone ? undefined : from, after), timestamp: Date.now() }];
      await agent.continue();
    }
    return live ? finish() : save();
  } finally {
    suggestions.drop(made); // a run that saved no reply: its suggestions would have nothing to show under
    // What the run used, quiet runs and failed ones included.
    const used = agent.state.messages.slice(before).filter((m): m is AssistantMessage => m.role === "assistant");
    if (used.length && sprockets.get(id)) usage.add(id, used.reduce((n, m) => n + (m.usage?.totalTokens ?? 0), 0), used.reduce((n, m) => n + (m.usage?.cost?.total ?? 0), 0));
  }

  /** The end of a run outside the project chat: its tool steps go with its messages, then its pass line or question. */
  function finish(): Outcome | undefined {
    if (stale()) return;
    const added = agent.state.messages.slice(before);
    // Each posted message gets the tool steps before it, and the last one those after it too, so later runs see
    // what it looked at in order. Its text is in the messages already, so the steps keep only the calls.
    let steps_: Message[] = [];
    let lastPosted: SprocketMessage | undefined;
    for (const m of added) {
      const message = m.role === "assistant" ? posted.get(m as AssistantMessage) : undefined;
      if (message) {
        sprocketMessages.addSteps(message.id, steps_);
        steps_ = [];
        lastPosted = message;
      }
      if (m.role === "assistant") {
        const calls = (m as AssistantMessage).content.filter((c) => c.type !== "text");
        if (calls.some((c) => c.type === "toolCall")) steps_.push({ ...(m as AssistantMessage), content: calls });
      } else if (m.role === "toolResult") steps_.push(trimStep(m));
    }
    if (!lastPosted && sent.length) lastPosted = sent.at(-1);
    let outcome: Outcome | undefined;
    const e = end as TurnEnd | undefined;
    if (e && "ask" in e) {
      const asked = sprocketMessages.create(chatId, "sprocket", e.ask.question, postTime(chatId), { sprocketId: id, runId: r.id, ask: e.ask, steps: steps_ });
      steps_ = [];
      lastPosted = asked;
      outcome = { asked: true };
    }
    if (lastPosted) {
      sprocketMessages.addSteps(lastPosted.id, steps_);
      const activity = summarize(capabilities, done);
      if (activity) sprocketMessages.setActivity(lastPosted.id, activity);
      suggestions.attach(made.splice(0), lastPosted.id); // a Coordinator's drafts, under its last message
    }
    if (e && "quiet" in e) {
      automationRuns.setQuiet(r.id, e.quiet);
      if (r.sourceId) sprocketMessages.setAutomationQuiet(r.sourceId);
    }
    if (e && "passTo" in e) {
      // Your message after this run started takes the team elsewhere (teams.ts): its pass doesn't count then.
      const overtaken = sprocketMessages.list(chatId).some((m) => m.author === "user" && Date.parse(m.createdAt) > start);
      if (!overtaken) {
        const line = sprocketMessages.create(chatId, "pass", e.note, postTime(chatId), { sprocketId: id, runId: r.id, passTo: e.passTo });
        outcome = { passed: { passTo: e.passTo, sourceId: line.id } };
      }
    }
    endNotice(added.filter((m): m is AssistantMessage => m.role === "assistant").at(-1), !posted.size && !sent.length && !e);
    changed();
    return outcome;
  }

  /** The end of a run in the project chat: one reply, dated at the run's start, with its suggestions under it. */
  function save(): undefined {
    if (stale()) return;
    const added = agent.state.messages.slice(before);
    const reply = added.filter((m): m is AssistantMessage => m.role === "assistant").at(-1);
    const text = reply ? textOf(reply) : "";
    // This run's tool calls and results: everything it added before the reply itself.
    const work = added.filter((m) => m !== reply).map(trimStep);
    // Woken by events that turned out not to need the user: mark them, and keep the chat free of the reply.
    if (QUIET.test(text) && !made.length && unanswered.length && unanswered.every((m) => m.author === "event")) {
      for (const m of unanswered) sprocketMessages.setQuiet(m.id);
      return;
    }
    if (text) {
      const saved = sprocketMessages.create(chatId, "sprocket", text, startedAt, { activity: summarize(capabilities, done), steps: work, sprocketId: id, runId: r.id });
      suggestions.attach(made.splice(0), saved.id);
    }
    endNotice(reply, !text);
  }

  /** Rails' line when a run ended badly: stopped at its step limit, a model error, or (`empty`) nothing written. */
  function endNotice(reply: AssistantMessage | undefined, empty: boolean): void {
    if (steps > MAX_STEPS) notice(chatId, `Stopped after ${MAX_STEPS} steps.`, id);
    else if (reply?.stopReason === "error") notice(chatId, `The model returned an error: ${readableError(reply.errorMessage)}`, id);
    else if (empty) notice(chatId, "The model sent an empty reply.", id);
  }
}

/** A tool result as it's saved for later runs: its text trimmed, its call details (for the UI) dropped. */
function trimStep(m: Message): Message {
  if (m.role !== "toolResult") return m;
  const text = m.content.map((c) => (c.type === "text" ? c.text : "[image]")).join("");
  const trimmed = text.length > STEP_RESULT_CHARS ? `${text.slice(0, STEP_RESULT_CHARS)}\n[…trimmed from ${text.length} characters when it was saved]` : text;
  return { role: "toolResult", toolCallId: m.toolCallId, toolName: m.toolName, content: [{ type: "text", text: trimmed }], isError: m.isError, timestamp: m.timestamp };
}

/** Provider errors often embed a JSON body; show its message, not the JSON. */
export function readableError(raw: string | undefined): string {
  if (!raw) return "unknown error";
  const status = raw.match(/\b([45]\d\d)\b/)?.[1];
  const message = raw.match(/"(?:message|detail)"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  const text = message ? (status ? `${status} ${message}` : message) : raw;
  return text.length > 300 ? text.slice(0, 300) + "…" : text;
}

/**
 * A team member's reply without its own name in front ("[Scout] …", "Scout: …"): the others' messages reach it
 * with their names in brackets, and models copy that.
 */
function withoutName(text: string, name: string): string {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^(\\[${n}\\]|\\*{0,2}${n}(:\\*{0,2}|\\*{0,2}:))\\s*`, "i"), "").trim();
}

/** OpenAI's phase of a text block: "commentary" (a note on the way) or "final_answer". */
const phaseOf = (signature: string | undefined): string | undefined => {
  try {
    return JSON.parse(signature ?? "").phase;
  } catch {
    return undefined;
  }
};

/**
 * The text of a model message, a paragraph per block. A message with a final answer drops its own commentary
 * blocks: models write a draft of the answer there first, and it would show twice.
 */
export function textOf(m: Pick<AssistantMessage, "content">): string {
  const blocks = m.content.filter((c) => c.type === "text");
  const final = blocks.some((c) => phaseOf(c.textSignature) === "final_answer");
  return blocks
    .filter((c) => !final || phaseOf(c.textSignature) !== "commentary")
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A Coordinator's reply when an event doesn't need the user: (quiet), or an explanation that ends with it (the
 * user isn't told either way).
 */
const QUIET = /(^\(?quiet\)?|\(quiet\))\.?$/i;

/** A tool's name as a button's label: its title as it is, or "add_note" as "Add note". */
const labelOf = (title: string) => (/[\s]/.test(title) ? title : (title.charAt(0).toUpperCase() + title.slice(1)).replace(/[_-]+/g, " "));

/**
 * Two texts that say the same: equal, or nearly the same words (a model repeating its message reworded a little).
 * Short ones only when equal.
 */
function alike(a: string, b: string): boolean {
  const words = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const x = words(a);
  const y = words(b);
  if (x.join(" ") === y.join(" ")) return true;
  if (Math.min(x.length, y.length) < 8) return false;
  const inY = new Set(y);
  const shared = x.filter((w) => inY.has(w)).length;
  return shared / Math.max(x.length, y.length) >= 0.85;
}
