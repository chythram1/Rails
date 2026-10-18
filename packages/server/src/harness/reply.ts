// suggest_reply (ADR 0010): a Coordinator drafts what its user could answer a session. It's an "act"
// capability, but all it changes is what the user is shown: nothing reaches the session until the user sends
// it. Whether the Sprocket may suggest at all is checked when it's called, not when the run started.
import { Type } from "@earendil-works/pi-ai";
import { sprockets } from "../db.ts";
import { suggest, SUGGESTION_MAX } from "../suggestions.ts";
import type { Capability } from "./capabilities.ts";
import { findOpen, session } from "./project.ts";

/**
 * `suggest_reply` for a Coordinator's run; `made` hears each suggestion's id, so the run can show it under its
 * reply. `rules` are the rules as the run's prompt numbered them, so a number means what the model read.
 */
export function suggestReplyCapability(rules: string[], made: (id: string) => void): Capability {
  return {
    name: "suggest_reply",
    description: `Suggest what your user could reply to a session in your project: one that ended its turn (it asked something, or your user asked you to tell it something) or one waiting on a question in a dialog. Your user sees it under your message and sends it, edits it or dismisses it: nothing reaches the session until they do. Write it as your user would, in the first person, short and plain (at most ${SUGGESTION_MAX} characters). For a dialog, give the option you'd pick; your user picks it in the panel. When one of your user's rules decides the reply, pass its number as \`rule\`; leave it out when you're using your own judgment. One per session: a new one replaces the last. Resolves to what happens next.`,
    params: Type.Object({
      session,
      reply: Type.String({ description: "The reply, as your user would write it." }),
      rule: Type.Optional(Type.Integer({ minimum: 1, description: "The number of the rule this follows, if one does." })),
    }),
    effect: "act",
    log: {
      doing: () => "Drafting a reply",
      done: (calls) => (calls.length > 1 ? `drafted ${calls.length} replies` : "drafted a reply"),
    },
    run: async (args, ctx) => {
      const me = sprockets.get(ctx.sprocketId);
      if (!ctx.project || !me?.coordinator || me.projectId !== ctx.project.id)
        throw new Error("Only your project's Coordinator suggests replies to sessions. Your user can make you the Coordinator in your settings.");
      const rule = args.rule === undefined ? undefined : rules[args.rule - 1];
      if (args.rule !== undefined && !rule) throw new Error(`There's no rule ${args.rule}: you have ${rules.length}. Leave \`rule\` out if none fits.`);
      const found = await findOpen(ctx.project, args.session);
      const s = suggest(ctx.sprocketId, found, found.title, args.reply, rule);
      made(s.id);
      return s.mode === "reply"
        ? `Suggested. Your user sees it under your message and decides whether to send it to "${found.title}". Don't repeat the reply in your message.`
        : `Suggested. "${found.title}" is waiting on a dialog, so your user answers it in its panel; they see your suggestion with a button to open it. Don't repeat it in your message.`;
    },
  };
}
