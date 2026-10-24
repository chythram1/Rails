// Ending a turn on purpose (ADR 0023): `ask_user` asks the user a question with options to tap, and an automation's
// run with nothing to report calls `nothing_new`. Either ends the run once its script is done (codemode.ts's
// `ends`), so the model writes its message first and calls it last.
import { Type } from "@earendil-works/pi-ai";
import { ASK_OPTIONS_MAX, ASK_OPTIONS_MIN, AUTOMATION_SUMMARY_MAX, type SprocketAsk } from "@rails/shared";
import type { Capability } from "./capabilities.ts";

/** How a run ended on purpose: the question it asked, or an automation's run with nothing new. */
export type TurnEnd =
  | { ask: SprocketAsk }
  /** An automation's run found nothing to tell its user (ADR 0032): what it checked, in a line. */
  | { quiet: string };

const QUESTION_MAX = 240;
const OPTION_MAX = 80;

/** `ask_user`: a question for the user, with options to tap or open. `end` records it, once per run. */
export function askUserCapability(end: (e: TurnEnd) => void, ended: () => boolean): Capability {
  return {
    name: "ask_user",
    description: `Ask your user a short question when you can't go on without their answer (their choice, a fact only they know); their answer comes back to you. Don't use it when you can already give a useful answer: give it, saying what you assumed. Give ${ASK_OPTIONS_MIN} to ${ASK_OPTIONS_MAX} options to tap when a few short answers are likely: each is an answer they'd send as it is ("Calm", "Bold"), never a way to answer ("Tell you the vibe", "Something else"). Leave options out for an open question ("What does the app do?"). It shows as your message, so don't also write the question. Your turn ends when this script ends.`,
    params: Type.Object({
      question: Type.String({ maxLength: QUESTION_MAX }),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: OPTION_MAX }), { maxItems: ASK_OPTIONS_MAX })),
    }),
    effect: "act",
    log: { doing: () => "Asking its user", done: () => "asked its user" },
    run: async ({ question, options = [] }: { question: string; options?: string[] }) => {
      if (ended()) throw new Error("Your turn already ends: you can pass it, or ask your user, once.");
      const opts = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
      if (!question.trim()) throw new Error("The question is empty.");
      if (opts.length === 1) throw new Error(`Give ${ASK_OPTIONS_MIN} to ${ASK_OPTIONS_MAX} different options, or none for an open question.`);
      end({ ask: { question: question.trim(), options: opts } });
      return "Asked. Your turn ends when this script does: don't write anything more.";
    },
  };
}

/** Messages one run may post with send_message. */
const SENDS_MAX = 5;

/** `send_message`: a message of its own in the chat right away (a heads-up, a second message in a row); the turn goes on. */
export function sendMessageCapability(post: (text: string) => void): Capability {
  let sent = 0;
  return {
    name: "send_message",
    description: `Post a message in this chat right away, as its own message, and keep going: for a quick heads-up before you look something up, or several messages in a row. Your reply after your last tool call is posted too, so don't repeat it here. At most ${SENDS_MAX} per turn.`,
    params: Type.Object({ text: Type.String({ minLength: 1, maxLength: 2000 }) }),
    effect: "act",
    echo: true,
    log: { doing: () => "Writing", done: (calls) => `sent ${calls.length === 1 ? "a message" : `${calls.length} messages`}` },
    run: async ({ text }: { text: string }) => {
      if (!text.trim()) throw new Error("The message is empty.");
      if (++sent > SENDS_MAX) throw new Error(`You've sent ${SENDS_MAX} messages this turn: put the rest in your reply.`);
      post(text.trim());
      return "Sent: it's in the chat now, so don't write it again.";
    },
  };
}

/**
 * `nothing_new`, in an automation's run only (ADR 0032): nothing this time is worth a message, so nothing is posted
 * and the run is listed as Nothing new with its summary. `said` is whether the run has posted anything yet.
 */
export function nothingNewCapability(end: (e: TurnEnd) => void, ended: () => boolean, said: () => boolean): Capability {
  return {
    name: "nothing_new",
    description:
      "In an automation's run: when its instructions leave nothing to tell this time (they ask about changes and nothing changed, or nothing matched), call this instead of writing a message. Not when they ask for something each time. Nothing is posted in the chat; `summary` is one line for the automation's run list saying what you checked (\"No new issues since Monday 09:00\"). Your turn ends when this script ends.",
    params: Type.Object({ summary: Type.String({ minLength: 1, maxLength: AUTOMATION_SUMMARY_MAX }) }),
    effect: "act",
    log: { doing: () => "Finding nothing new", done: () => "found nothing new" },
    run: async ({ summary }: { summary: string }) => {
      if (ended()) throw new Error("Your turn already ends.");
      if (said()) throw new Error("You've already written to your user this run, so it isn't quiet: just end your turn.");
      if (!summary.trim()) throw new Error("Say in `summary` what you checked.");
      end({ quiet: summary.trim() });
      return "Noted: nothing is posted. Your turn ends when this script does: don't write anything more.";
    },
  };
}

