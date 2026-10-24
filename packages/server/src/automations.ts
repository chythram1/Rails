// Automations (ADR 0032): a Sprocket, a prompt and a schedule. When one is due, Rails posts its line in the
// Sprocket's direct chat and queues a run there (runs.ts, trigger `automation`); this module watches that run end
// and records how it went. Changes are broadcast as automations.changed.
import {
  AUTOMATION_FAILS_TO_PAUSE,
  AUTOMATION_NAME_MAX,
  AUTOMATION_PROMPT_MAX,
  AUTOMATION_RECENT,
  AUTOMATION_SUMMARY_MAX,
  actionSettled,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type AutomationTrigger,
  type SprocketMessage,
} from "@rails/shared";
import { automationRuns, automations, sprocketMessages, sprocketRuns, sprockets, tx, type StoredAutomation, type StoredAutomationRun } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { onRunsChanged, queueAutomationRun, startQueued, userMessageTime } from "./runs.ts";
import { knownTimezone, nextRun, scheduleProblem } from "./schedules.ts";
import { directChat } from "./sprockets.ts";
import { listeners } from "./util.ts";

const changes = listeners<[]>();
export const onAutomationsChanged = changes.on;
const changed = () => changes.emit();

/** How often the scheduler looks for automations that are due. */
const TICK_MS = 30_000;

const publicRun = ({ sprocketRunId: _r, messageId: _m, ...run }: StoredAutomationRun): AutomationRun => run;

function toAutomation(a: StoredAutomation): Automation {
  const recent = automationRuns.list(a.id, AUTOMATION_RECENT);
  const stats = { ...automationRuns.stats(a.id), recent: recent.map((r) => r.outcome).reverse() };
  return { ...a, ...(recent[0] ? { lastRun: publicRun(recent[0]) } : {}), stats };
}

export function listAutomations(): Automation[] {
  return automations.list().map(toAutomation);
}

function stored(id: string): StoredAutomation {
  const a = automations.get(id);
  if (!a) throw new ServiceError("Not found", 404);
  return a;
}

/** One automation and its runs, newest first. */
export function getAutomation(id: string): { automation: Automation; runs: AutomationRun[] } {
  const a = stored(id);
  return { automation: toAutomation(a), runs: automationRuns.list(id).map(publicRun) };
}

/** The next time it's due from now, or none while it's off (or its schedule stopped firing). */
function due(a: Pick<StoredAutomation, "enabled" | "schedule" | "timezone">, now = new Date()): string | undefined {
  return a.enabled ? nextRun(a.schedule, a.timezone, now)?.toISOString() : undefined;
}

/** The input checked and filled in from `current`; a ServiceError (400) says what's wrong. */
function checked(input: AutomationInput, current?: StoredAutomation): Omit<StoredAutomation, "id" | "createdAt" | "pausedReason" | "nextRunAt"> {
  const name = (input.name ?? current?.name ?? "").trim();
  const prompt = (input.prompt ?? current?.prompt ?? "").trim();
  const sprocketId = input.sprocketId ?? current?.sprocketId ?? "";
  const schedule = input.schedule ?? current?.schedule;
  const timezone = (input.timezone ?? current?.timezone ?? "").trim();
  const enabled = input.enabled ?? current?.enabled ?? true;
  if (!name) throw new ServiceError("Give it a name.", 400);
  if (name.length > AUTOMATION_NAME_MAX) throw new ServiceError(`Names are at most ${AUTOMATION_NAME_MAX} characters.`, 400);
  if (!prompt) throw new ServiceError("Say what it should do.", 400);
  if (prompt.length > AUTOMATION_PROMPT_MAX) throw new ServiceError(`Instructions are at most ${AUTOMATION_PROMPT_MAX} characters.`, 400);
  if (!sprockets.get(sprocketId)) throw new ServiceError("Pick a Sprocket to run it.", 400);
  if (!timezone || !knownTimezone(timezone)) throw new ServiceError("Pick a timezone.", 400);
  if (!schedule || typeof schedule !== "object") throw new ServiceError("Pick a schedule.", 400);
  // A schedule that's kept as it was may have passed (a once that ran): only a new one, or turning it on, is checked.
  if (input.schedule || input.timezone || (enabled && !current?.enabled)) {
    const problem = scheduleProblem(schedule, timezone);
    if (problem) throw new ServiceError(problem, 400);
  }
  return { name, prompt, sprocketId, schedule, timezone, enabled };
}

export function createAutomation(input: AutomationInput): Automation {
  const a = checked(input);
  const made = automations.create({ ...a, nextRunAt: due(a) });
  changed();
  return toAutomation(made);
}

/** Change it; turning it on (or changing when it runs) counts its next run from now, and clears why it was paused. */
export function updateAutomation(id: string, input: AutomationInput): Automation {
  const current = stored(id);
  const a = checked(input, current);
  const when = input.schedule || input.timezone || input.enabled !== undefined;
  const nextRunAt = when ? due(a) : current.nextRunAt;
  automations.update(id, { ...a, pausedReason: a.enabled ? undefined : current.pausedReason, nextRunAt });
  changed();
  return toAutomation(stored(id));
}

export function deleteAutomation(id: string): void {
  stored(id);
  automations.remove(id);
  changed();
}

const isRunning = (id: string) => automationRuns.list(id, 1)[0]?.outcome === "running";

/** Run it now, whatever its schedule (Run now). Refused while its last run is still going. */
export function runAutomation(id: string): AutomationRun {
  const a = stored(id);
  if (isRunning(id)) throw new ServiceError("It's running now.", 409);
  const run = fire(a, "manual");
  startQueued();
  changed();
  return publicRun(run);
}

/**
 * Post its line in its Sprocket's direct chat and queue the run there; skipped while its last run still goes. The
 * line, the queued run and its row are written together or not at all, and the run only starts once the caller
 * calls `startQueued()`, after they're in.
 */
function fire(a: StoredAutomation, trigger: AutomationTrigger): StoredAutomationRun {
  if (isRunning(a.id)) return automationRuns.create({ automationId: a.id, trigger, outcome: "skipped", summary: "Its previous run hadn't finished." });
  return tx(() => {
    const chatId = directChat(a.sprocketId);
    const line = sprocketMessages.create(chatId, "automation", a.prompt, userMessageTime(chatId), { automation: { id: a.id, name: a.name, trigger } });
    const sprocketRunId = queueAutomationRun(chatId, a.sprocketId, line.id);
    return automationRuns.create({ automationId: a.id, trigger, outcome: "running", sprocketRunId, messageId: line.id });
  });
}

/**
 * Start the automations that are due at `now`: each once, however many times it missed while the server was down,
 * and its next run counted from now. A once that ran turns off.
 */
export function tick(now = new Date()): void {
  const ready = automations.list().filter((a) => a.enabled && a.nextRunAt && Date.parse(a.nextRunAt) <= now.getTime());
  for (const a of ready) {
    try {
      // Fired and moved on to its next time together: a failure halfway would fire it again on every tick.
      tx(() => {
        fire(a, "schedule");
        const once = a.schedule.kind === "once";
        automations.update(a.id, { ...a, enabled: !once, nextRunAt: once ? undefined : due(a, now) });
      });
    } catch (e) {
      console.error(`automation ${a.id}:`, e); // the others still run; this one is tried again next tick
    }
  }
  if (!ready.length) return;
  startQueued();
  changed();
}

/** The first line of a message, cut to a summary's length. */
function oneLine(text: string): string {
  const line = text.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > AUTOMATION_SUMMARY_MAX ? `${line.slice(0, AUTOMATION_SUMMARY_MAX - 1)}…` : line;
}

/** How a finished Sprocket run went, for its automation's run list. */
function outcomeOf(run: StoredAutomationRun, status: string, error: string | undefined, chatId: string): { outcome: AutomationRun["outcome"]; summary: string } {
  const posted = sprocketMessages.ofRun(run.sprocketRunId!);
  const said = posted.find((m) => m.text.trim() && !m.ask && !m.card);
  const waiting = (m: SprocketMessage) => (m.ask && !m.ask.answer) || m.card?.actions?.some((x) => !actionSettled(x)) || m.approval?.status === "pending";
  const first = said ?? posted[0];
  const summary = first ? oneLine(first.card?.title || first.text) : "";
  if (status === "waiting" || posted.some(waiting)) return { outcome: "needs_you", summary: summary || "Something waits for you in its chat." };
  if (status === "done" && posted.length) return { outcome: "done", summary };
  // Failed, cancelled, or ended without a word: Rails' own line in the chat after the automation's says why.
  const line = run.messageId ? sprocketMessages.get(run.messageId) : undefined;
  const notice = sprocketMessages
    .list(chatId)
    .filter((m) => m.author === "notice" && (!line || m.createdAt >= line.createdAt))
    .at(-1);
  const why = notice?.text ?? (status === "cancelled" ? "It was cancelled (its chat was cleared)." : error ? `Something went wrong: ${error}` : "It didn't reply.");
  return { outcome: "failed", summary: oneLine(why) };
}

/** Record how runs that ended went; after AUTOMATION_FAILS_TO_PAUSE failures in a row, turn the automation off. */
function settle(): void {
  let any = false;
  for (const run of automationRuns.running()) {
    const sr = run.sprocketRunId ? sprocketRuns.get(run.sprocketRunId) : undefined;
    if (sr && (sr.status === "queued" || sr.status === "running")) continue;
    const a = automations.get(run.automationId);
    if (!sr || !a) {
      automationRuns.end(run.id, "failed", "Its run was lost.");
      any = true;
      continue;
    }
    const { outcome, summary } = outcomeOf(run, sr.status, sr.error, sr.chatId);
    automationRuns.end(run.id, outcome, summary);
    any = true;
    if (outcome === "failed") pauseIfFailing(a, summary);
  }
  if (any) changed();
}

function pauseIfFailing(a: StoredAutomation, reason: string): void {
  const recent = automationRuns.list(a.id, 20).filter((x) => x.outcome !== "skipped" && x.outcome !== "running").slice(0, AUTOMATION_FAILS_TO_PAUSE);
  if (recent.length < AUTOMATION_FAILS_TO_PAUSE || recent.some((x) => x.outcome !== "failed") || !a.enabled) return;
  automations.update(a.id, { ...a, enabled: false, pausedReason: `It failed ${AUTOMATION_FAILS_TO_PAUSE} times in a row. The last time: ${reason}`, nextRunAt: undefined });
}

let timer: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | undefined;

/** When the server starts: settle runs that ended meanwhile, start what's due, then look every TICK_MS. */
export function startAutomations(): void {
  if (timer) return;
  unsubscribe = onRunsChanged(settle);
  settle();
  tick();
  timer = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error("automations:", e); // the next tick tries again
    }
  }, TICK_MS);
  timer.unref?.();
}

export function stopAutomations(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
}
