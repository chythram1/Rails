// Ending a turn on purpose (ADR 0023): `pass_turn` gives a teammate the next turn in a team chat, and `ask_user`
// asks the user a question with options to tap. Either ends the run once its script is done (codemode.ts's
// `ends`), so the model writes its message first and calls one of them last.
import { Type } from "@earendil-works/pi-ai";
import { ASK_OPTIONS_MAX, ASK_OPTIONS_MIN, AUTOMATION_SUMMARY_MAX, TEAM_TURNS_MAX, type SprocketAsk } from "@rails/shared";
import type { Capability } from "./capabilities.ts";

/** How a run ended on purpose: the teammate it passed to (and what for), or the question it asked. */
export type TurnEnd =
  | { passTo: string; note: string }
  | { ask: SprocketAsk }
  /** Nothing more to do: it passed to a teammate whose turn already comes, after posting its part. */
  | { done: true }
  /** An automation's run found nothing to tell its user (ADR 0032): what it checked, in a line. */
  | { quiet: string };

/** A pass's note, shown on its line: what the teammate should do next. */
export const PASS_NOTE_MAX = 160;

const QUESTION_MAX = 240;
const OPTION_MAX = 80;

/**
 * `pass_turn` for a team member's run. `others` are its teammates; `hop` passes led here, `queued` are the
 * teammates whose turns already come (as after @everyone), `asking` those whose question waits for the user's
 * answer, and `said` whether the run has posted a message yet.
 * `end` records the pass, once per run. Passing back to whoever passed it is fine: a conversation goes back and
 * forth, and TEAM_TURNS_MAX stops it.
 */
export function passTurnCapability(
  others: { id: string; name: string }[],
  turn: { hop: number; queued: () => string[]; asking: () => string[]; said: () => boolean },
  end: (e: TurnEnd) => void,
  ended: () => boolean,
): Capability {
  return {
    name: "pass_turn",
    description:
      "Give a teammate the next turn in this team chat, after you've written your message (with your part of the work in it). They go next, and your turn ends when this script ends. `to` is their name; `note` says in a few words what they should do now, and shows on the line in the chat.",
    params: Type.Object({
      to: Type.String({ description: "The teammate's name." }),
      note: Type.String({ maxLength: PASS_NOTE_MAX, description: "What they should do now, in a few words (\"check the draft for risky claims\")." }),
    }),
    effect: "act",
    log: { doing: (a) => `Passing the turn to ${a.to}`, done: (calls) => `passed the turn to ${calls.map((c) => c.to).join(", ")}` },
    run: async ({ to, note }: { to: string; note: string }) => {
      if (ended()) throw new Error("Your turn already ends: you can pass it, or ask your user, once.");
      const name = to.replace(/^@/, "").trim().toLowerCase();
      const target = others.find((m) => m.name.toLowerCase() === name);
      if (!target) throw new Error(`There's no teammate called ${JSON.stringify(to)}. Your teammates: ${others.map((m) => m.name).join(", ")}.`);
      if (turn.queued().includes(target.id)) {
        if (!turn.said()) throw new Error(`${target.name} already has a turn coming after yours: they'll answer it themselves. Give your own answer, and don't pass the turn.`);
        // Its part is posted and the teammate goes next anyway: end the turn, or models wrote their message again.
        end({ done: true });
        return `${target.name} already has a turn coming after yours and will see your message. Your turn ends here.`;
      }
      // A teammate waiting on its own question to the user: a turn now would ask it again (seen live, models
      // passed to have them ask what they already had). The user's answer gives them their next turn.
      if (turn.asking().includes(target.id)) {
        if (!turn.said()) throw new Error(`${target.name}'s question is waiting for your user's answer, and their answer gives ${target.name} the next turn. Give your own answer, and don't pass the turn to them.`);
        end({ done: true });
        return `${target.name}'s question is already waiting for your user's answer, and their answer gives ${target.name} the next turn. Your turn ends here.`;
      }
      if (turn.hop + 1 > TEAM_TURNS_MAX)
        throw new Error(`The turn has been passed ${TEAM_TURNS_MAX} times since your user wrote: post your result here, and your user decides what's next.`);
      if (!note.trim()) throw new Error("Say in `note` what they should do now.");
      if (!turn.said())
        throw new Error(
          "You haven't written anything in the chat this turn, so your teammate would have nothing to go on. Post your message first (your part of the work, or what you need from them), with send_message or as your reply's text before this call, then pass the turn.",
        );
      end({ passTo: target.id, note: note.trim() });
      return `${target.name} has the next turn. Your turn ends when this script does: don't write anything more.`;
    },
  };
}

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
export const SENDS_MAX = 5;

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

