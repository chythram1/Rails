// What a Coordinator drafts for sessions (ADR 0010): suggest_reply answers a question a session asked its
// user; suggest_message passes on something the user asked it to tell a session. Both are "act" capabilities,
// but all they change is what the user is shown: nothing reaches a session until the user sends it. Whether
// the Sprocket may suggest at all is checked when it's called, not when the run started.
import { Type } from "@earendil-works/pi-ai";
import { sprockets } from "../db.ts";
import { suggest, SUGGESTION_MAX, type Purpose } from "../suggestions.ts";
import type { Capability, RunContext } from "./capabilities.ts";
import { findOpen, session } from "./project.ts";

/**
 * A Coordinator's capabilities for drafting what sessions get; `made` hears each suggestion's id, so the run can
 * show it under its reply. `rules` are the rules as the run's prompt numbered them, so a number means what the
 * model read.
 */
export function replyCapabilities(rules: string[], made: (id: string) => void): Capability[] {
  const draft = async (ctx: RunContext, name: string, sessionArg: string, text: string, opts: { rule?: string; purpose: Purpose }) => {
    const me = sprockets.get(ctx.sprocketId);
    if (!ctx.project || !me?.coordinator || me.projectId !== ctx.project.id)
      throw new Error(`Only your project's Coordinator can use ${name}. Your user can make you the Coordinator in your settings.`);
    const found = await findOpen(ctx.project, sessionArg);
    const s = suggest(ctx.sprocketId, found, found.title, text, opts);
    made(s.id);
    return { s, title: found.title };
  };

  return [
    {
      name: "suggest_reply",
      description: `Suggest an answer to a question a session in your project asked your user: one that ended its turn asking something, or one waiting on a question in a dialog. Your user sees it under your message and sends it, edits it or dismisses it: nothing reaches the session until they do. Write it as your user would, in the first person, short and plain (at most ${SUGGESTION_MAX} characters). For a dialog, give the option you'd pick, exactly as it's labelled, or for an open question (no options) the answer to type; your user answers it in the panel. When one of your user's rules decides the answer, pass its number as \`rule\`; leave it out when you're using your own judgment. To pass on something your user asked you to tell a session, use suggest_message instead. One suggestion per session: a new one replaces the last. Resolves to what happens next.`,
      params: Type.Object({
        session,
        reply: Type.String({ description: "The answer, as your user would write it." }),
        rule: Type.Optional(Type.Integer({ minimum: 1, description: "The number of the rule this follows, if one does." })),
      }),
      effect: "act",
      log: {
        doing: () => "Drafting a reply",
        done: (calls) => (calls.length > 1 ? `drafted ${calls.length} replies` : "drafted a reply"),
      },
      run: async (args, ctx) => {
        const rule = args.rule === undefined ? undefined : rules[args.rule - 1];
        if (args.rule !== undefined && !rule) throw new Error(`There's no rule ${args.rule}: you have ${rules.length}. Leave \`rule\` out if none fits.`);
        const { s, title } = await draft(ctx, "suggest_reply", args.session, args.reply, { rule, purpose: "answer" });
        return s.mode === "reply"
          ? `Suggested. Your user sees it under your message and decides whether to send it to "${title}". Don't repeat the reply in your message.`
          : `Suggested. "${title}" is waiting on a dialog, so your user answers it in its panel; they see your suggestion with a button to open it. Don't repeat it in your message.`;
      },
    },
    {
      name: "suggest_message",
      description: `Draft a message for a session in your project: something your user asked you to pass on ("tell it to stop and summarize"), or a heads-up when Rails tells you two sessions changed the same files. Your user sees it under your message and sends it, edits it or dismisses it: nothing reaches the session until they do. A session that's busy or waiting on a question gets it after its current turn, in its own queue. Write it as your user would, in the first person (at most ${SUGGESTION_MAX} characters). For answering a question a session asked, use suggest_reply. One suggestion per session: a new one replaces the last. Resolves to what happens next.`,
      params: Type.Object({ session, message: Type.String({ description: "The message, as your user would write it." }) }),
      effect: "act",
      log: {
        doing: () => "Drafting a message",
        done: (calls) => (calls.length > 1 ? `drafted ${calls.length} messages` : "drafted a message"),
      },
      run: async (args, ctx) => {
        const { title } = await draft(ctx, "suggest_message", args.session, args.message, { purpose: "message" });
        return `Drafted. Your user sees it under your message and decides whether to send it to "${title}"; if it's busy, it gets it after its current turn. Don't repeat the message in your message.`;
      },
    },
  ];
}
