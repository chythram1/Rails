// System 1 in shadow (ADR 0012). A fast decision model (a classifier through pi-ai's classify(): TypeSafe's
// Jev, OpenAI's GPT-6 Luna as a classifier, …) answers typed questions about the moments the watches decide in
// code, and only the log sees its answers, next to what Rails did. The point is to learn, on the user's real
// sessions, whether it would wake the Coordinator better than the code does before anything acts on it.
// - Only where it matters: sessions in projects with a Coordinator, and only when the user picked a model
//   (it sends the end of a session's message, or a dialog's title, to that model's provider).
// - A turn end: "does it ask the user something?", next to looksLikeQuestion's answer.
// - A dialog Rails doesn't know (a pi extension's, without questions): "a question, an approval or something
//   else?" Rails never wakes anyone for those.
// - Bounded: a short text per question, a deadline per call, a few calls a minute. Failures are logged.
// - It may also wake the Coordinator where the rules didn't, when it's sure (ADR 0013): a turn end the rules
//   thought didn't ask (ACT_ASKS), a dialog it calls a question (ACT_QUESTION). It only adds wakes, never cancels
//   one, and not if the session moved on while it was asked. `RAILS_DECISIONS=shadow` keeps it to judging.
import type { ClassifierAnswer, ClassifierContext, ClassifierQuestion } from "@earendil-works/pi-ai";
import type { DecisionEntry, DecisionLog, Panel } from "@rails/shared";
import { AGENT } from "./bridge/board.ts";
import { ASKING, type SessionEvent } from "./bridge/events.ts";
import { onEvents } from "./bridge/index.ts";
import { decisions, settings, sprockets } from "./db.ts";
import { ServiceError } from "./errors.ts";
import { decisionsInShadow } from "./config.ts";
import { classifierChoices, findClassifier, models, modelsChanged } from "./models.ts";
import { listeners } from "./util.ts";
import { sessionTitle } from "./titles.ts";
import { eventPosition, looksLikeQuestion, onWake, wakeFromModel, type Wake } from "./watches.ts";

/** How much of a message's end the model sees. */
const TEXT = 1500;
const DEADLINE_MS = 8000;
/** Calls a minute, across all sessions: a guard against a flood of turn ends, not a budget. */
const MAX_PER_MINUTE = 20;
/** Judgments shown in the log. */
const SHOWN = 50;
/**
 * How sure it has to be to wake the Coordinator itself (ADR 0013). From the first evaluation (scratch/research/
 * system-one/eval): real questions scored 0.81–0.99, non-questions at most 0.78; dialogs it called questions
 * scored 0.95 and up, approvals 1.0 as approvals. Missing a wake costs the user's time and a false one only a run,
 * but trust comes first: high bars, revisited from the shadow log.
 */
export const ACT_ASKS = 0.9;
export const ACT_QUESTION = 0.95;
/** How much of a message's end an event keeps (as watches.ts). */
const EVENT_TAIL = 600;

const changes = listeners();
/** The decision model or the log changed. */
export const onDecisionsChanged = changes.on;

/** The typed questions, in the classifier API's shape. Plain wording: the model sees nothing else. */
export const QUESTIONS: Record<DecisionEntry["question"], { key: string; question: ClassifierQuestion }> = {
  turn_end: {
    key: "asks_user",
    question: {
      type: "bool",
      instructions:
        "This is the end of a coding agent's last message to its user, after it finished a turn. Does it ask the user something, or wait for the user's decision, before it goes on?",
      criteria: {
        true: "It asks the user a question, offers options to choose from, or asks for permission or a decision before going on.",
        false: "It reports finished work or states something; nothing in it needs an answer from the user. A closing pleasantry like \"let me know if you need anything\" doesn't count.",
      },
    },
  },
  dialog: {
    key: "dialog_kind",
    question: {
      type: "choice",
      instructions: "A coding agent's terminal is showing a dialog to its user. This is the dialog's title. What is it?",
      criteria: {
        question: "A question about the work: the agent wants the user's answer or choice.",
        approval: "A request to approve or allow an action, such as running a command or writing a file.",
        other: "Something else, such as a notice or a setting.",
      },
    },
  },
};

const tail = (s: string) => (s.length > TEXT ? "…" + s.slice(-TEXT) : s);

/** What a session event asks the model, if anything: the question and the text it judges. */
export function toJudge(e: SessionEvent): { question: DecisionEntry["question"]; text: string; rails: DecisionEntry["rails"] } | undefined {
  if (e.kind === "turn_end" && e.text.trim()) return { question: "turn_end", text: tail(e.text.trim()), rails: looksLikeQuestion(e.text) ? "asks" : "doesn't ask" };
  if (e.kind === "waiting" && !e.questions?.length && !ASKING.has(e.reason) && e.reason !== "question" && e.reason !== "approval" && !e.reason.startsWith("permission"))
    return { question: "dialog", text: e.reason, rails: "unknown" };
}

/** The model's answer as the log shows it. */
function readAnswer(question: DecisionEntry["question"], a: ClassifierAnswer | undefined): DecisionEntry["answer"] {
  if (!a) return undefined;
  if (question === "turn_end" && a.type === "bool") return a.probability >= 0.5 ? { label: "asks", probability: a.probability } : { label: "doesn't ask", probability: 1 - a.probability };
  if (a.type === "choice") return { label: a.choice, probability: a.probabilities[a.choice] ?? a.confidence };
}

const recent: number[] = [];
/** Judgments waiting for their answer (for tests and shutdown). */
const inFlight = new Set<Promise<void>>();

/**
 * Ask the model about one moment, and log its answer next to Rails' own. The entry is made at once (a wake
 * may link to it before the answer comes); the session's title as the user sees it follows.
 */
async function judge(panel: Panel, item: NonNullable<ReturnType<typeof toJudge>>, position: number): Promise<void> {
  const ref = settings.get("decisionModel");
  const model = ref ? findClassifier(ref) : undefined;
  if (!model) return;
  const id = decisions.create({ panelId: panel.id, title: panel.title, kind: panel.kind, ...item });
  decisions.setTitle(id, await sessionTitle(panel).catch(() => panel.title));
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MINUTE) {
    decisions.finish(id, { error: `Skipped: more than ${MAX_PER_MINUTE} a minute.` });
    return changes.emit();
  }
  recent.push(now);
  const { key, question } = QUESTIONS[item.question];
  const state: Record<string, string> = { agent: AGENT[panel.kind], [item.question === "turn_end" ? "message_end" : "dialog_title"]: item.text };
  const context: ClassifierContext = { state, questions: { [key]: question } };
  const started = Date.now();
  try {
    const result = await models.classify(model, context, { signal: AbortSignal.timeout(DEADLINE_MS) });
    const latencyMs = Date.now() - started;
    if (result.stopReason !== "stop") decisions.finish(id, { model: result.model, latencyMs, error: result.errorMessage ?? result.stopReason });
    else {
      const answer = readAnswer(item.question, result.answers[key]);
      // pi-ai prices a call at its catalog price, which is 0 for models it has no price for (Jev): no cost then, rather than $0.
      decisions.finish(id, { answer, model: result.model, latencyMs, cost: result.usage?.cost.total || undefined });
      const wake = decisionsInShadow() ? undefined : wakeFor(item, answer, id);
      if (wake) wakeFromModel(panel.id, position, wake);
    }
  } catch (e) {
    decisions.finish(id, { latencyMs: Date.now() - started, error: (e as Error).message });
  }
  changes.emit();
}

/** The wake a judgment calls for when the model may act: only where the rules didn't wake, only when it's sure. */
export function wakeFor(item: NonNullable<ReturnType<typeof toJudge>>, answer: DecisionEntry["answer"], decisionId: string): Wake | undefined {
  if (!answer) return undefined;
  if (item.question === "turn_end" && item.rails !== "asks" && answer.label === "asks" && answer.probability >= ACT_ASKS) {
    const text = item.text.length > EVENT_TAIL ? "…" + item.text.slice(-EVENT_TAIL) : item.text;
    return { what: "turn_end", text, decisionId };
  }
  if (item.question === "dialog" && answer.label === "question" && answer.probability >= ACT_QUESTION) return { what: "question", text: item.text, decisionId };
}

/** Resolves once every judgment in flight has its answer (for tests). */
export async function settled(): Promise<void> {
  while (inFlight.size) await Promise.all([...inFlight]);
}

/** Judge what sessions in projects with a Coordinator report, and follow where the wakes lead. */
export function startDecisions(): void {
  // The judgment behind a wake: its outcome shows whether it was worth it. A wake the model asked for names its
  // judgment; one the rules made links to the turn end's (a dialog's wake has no judgment behind it).
  onWake((panelId, messageId, wake) => {
    if (wake.decisionId) decisions.linkActed(wake.decisionId, messageId);
    else if (wake.what === "turn_end") decisions.linkWake(panelId, messageId, new Date(Date.now() - 10 * 60_000).toISOString());
  });
  onEvents((panel, events) => {
    if (!settings.get("decisionModel") || !sprockets.coordinatorOf(panel.projectId)) return;
    // Where the panel's events are now (the watches have already seen these): a later event makes the judgment stale.
    const position = eventPosition(panel.id);
    for (const e of events) {
      const item = toJudge(e);
      if (!item) continue;
      const p = judge(panel, item, position)
        .catch((err) => console.error("decisions:", err))
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
  });
}

/** Pick the decision model (a classifier `provider/model`), or none to stop. */
export async function setDecisionModel(raw: unknown): Promise<void> {
  if (raw !== null && (typeof raw !== "string" || !(await classifierChoices()).some((c) => c.ref === raw))) throw new ServiceError("Unknown decision model", 400);
  settings.set("decisionModel", raw);
  modelsChanged();
  changes.emit();
}

export function decisionLog(): DecisionLog {
  const entries = decisions.list(SHOWN);
  const turnEnds = entries.filter((e) => e.question === "turn_end" && e.answer);
  const extra = turnEnds.filter((e) => e.rails === "asks" && e.answer!.label !== "asks");
  return {
    entries,
    summary: {
      judged: turnEnds.length,
      agreed: turnEnds.filter((e) => e.answer!.label === e.rails).length,
      missed: turnEnds.filter((e) => e.rails !== "asks" && e.answer!.label === "asks").length,
      extra: extra.length,
      quiet: extra.filter((e) => e.outcome === "nothing needed").length,
      acted: entries.filter((e) => e.acted).length,
    },
  };
}
