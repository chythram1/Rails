// What a Coordinator drafts for sessions (ADR 0010): suggest_reply answers a question a session asked its
// user; suggest_message passes on something the user asked it to tell a session. Both are "act" capabilities,
// but all they change is what the user is shown: nothing reaches a session until the user sends it. Whether
// the Sprocket may suggest at all is checked when it's called, not when the run started. plan_handoff and
// cancel_handoff (ADR 0015) set up a message for later: when one session finishes, for another.
import { HANDOFF_NOTE_MAX } from "@rails/shared";
import { Type } from "@earendil-works/pi-ai";
import { cardOf } from "../bridge/index.ts";
import { handoffs, panels, sprockets, type StoredHandoff } from "../db.ts";
import { completeHandoff, dropHandoff, findHandoff, HANDOFF_TTL_MS, planHandoff } from "../handoffs.ts";
import { MAX_OWNED, setOwner } from "../owners.ts";
import { MAX_PENDING_MESSAGES, suggest, SUGGESTION_MAX, type Purpose } from "../suggestions.ts";
import type { Capability, RunContext } from "./capabilities.ts";
import { findOpen, session } from "./project.ts";

/**
 * A Coordinator's capabilities for drafting what sessions get; `made` hears each suggestion's id, so the run can
 * show it under its reply. `rules` are the rules as the run's prompt numbered them, so a number means what the
 * model read.
 */
export function replyCapabilities(rules: string[], made: (id: string) => void): Capability[] {
  /** The run's project, if this Sprocket is its Coordinator now. */
  const coordinating = (ctx: RunContext, name: string) => {
    const me = sprockets.get(ctx.sprocketId);
    if (!ctx.project || !me?.coordinator || me.projectId !== ctx.project.id)
      throw new Error(`Only your project's Coordinator can use ${name}. Your user can make you the Coordinator in your settings.`);
    return ctx.project;
  };
  /** Draft a suggestion; with `handoff`, the message that carries it out (ADR 0015). */
  const draft = async (ctx: RunContext, name: string, sessionArg: string, text: string, opts: { rule?: string; purpose: Purpose }, handoff?: StoredHandoff) => {
    const found = await findOpen(coordinating(ctx, name), sessionArg);
    // A handoff's message carries what the finished session said last, word for word.
    const from = handoff && panels.get(handoff.from.panelId);
    const said = from && cardOf(from).lastOutcome;
    const attachment = handoff && said ? { title: handoff.from.title, text: said } : undefined;
    // Nothing waits from here on, so a handoff the user cancels while the session was looked up gets no draft.
    if (handoff && !handoffs.pending(ctx.sprocketId).some((x) => x.id === handoff.id))
      throw new Error("That handoff isn't waiting anymore: your user cancelled it, or it ended. Don't draft its message.");
    const s = suggest(ctx.sprocketId, found, found.title, text, { ...opts, attachment });
    if (handoff) completeHandoff(handoff);
    made(s.id);
    return { s, title: found.title };
  };

  return [
    {
      name: "suggest_reply",
      description: `Suggest an answer to a question a session in your project asked your user: one that ended its turn asking something, or one waiting on a question in a dialog. Your user sees it under your message and sends it, edits it or dismisses it: nothing reaches the session until they do. Write it as your user would, in the first person, short and plain (at most ${SUGGESTION_MAX} characters). For a dialog, give the option you'd pick, exactly as it's labelled, or for an open question (no options) the answer to type; your user answers it in the panel. When one of your user's rules decides the answer, pass its number as \`rule\`; leave it out when you're using your own judgment. To pass on something your user asked you to tell a session, use suggest_message instead. One answer per session: a new one replaces your last. Resolves to what happens next.`,
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
        // The rule's words right after the answer: a last look that it fits and was followed.
        const check = rule ? ` It cites rule ${args.rule}: ${JSON.stringify(rule)} If that rule doesn't fit the question, or your answer doesn't do what it says, suggest again (it replaces this one).` : "";
        return s.mode === "reply"
          ? `Suggested. Your user sees it under your message and decides whether to send it to "${title}". Don't repeat the reply in your message.${check}`
          : `Suggested. "${title}" is waiting on a dialog, so your user answers it in its panel; they see your suggestion with a button to open it. Don't repeat it in your message.${check}`;
      },
    },
    {
      name: "suggest_message",
      description: `Draft a message for a session in your project: something your user asked you to pass on ("tell it to stop and summarize"), or a heads-up when Rails tells you two sessions changed the same files. Your user sees it under your message and sends it, edits it or dismisses it: nothing reaches the session until they do. A session that's busy or waiting on a question gets it after its current turn, in its own queue. Write it as your user would, in the first person (at most ${SUGGESTION_MAX} characters), so it stands on its own: the session sees nothing else (no chat, no other sessions), and can't talk to other sessions. For answering a question a session asked, use suggest_reply. With \`handoff\`, it carries out that handoff and goes to the session the handoff is for, and Rails attaches what the finished session said last, word for word: don't repeat or summarize it, say what to do with it. Messages don't replace each other: one session can have up to ${MAX_PENDING_MESSAGES} of yours waiting, so draft a new one only for something new. Never draft one that only says nothing is needed, that a change is fine, or what the session already knows: draft nothing then. Resolves to what happens next.`,
      params: Type.Object({
        session,
        message: Type.String({ description: "The message, as your user would write it." }),
        handoff: Type.Optional(Type.String({ description: "The id of the handoff this message carries out, when Rails woke you for one." })),
      }),
      effect: "act",
      log: {
        doing: () => "Drafting a message",
        done: (calls) => (calls.length > 1 ? `drafted ${calls.length} messages` : "drafted a message"),
      },
      run: async (args, ctx) => {
        // A handoff's message goes to the session the handoff is for.
        const h = args.handoff === undefined ? undefined : findHandoff(ctx.sprocketId, args.handoff);
        const { title } = await draft(ctx, "suggest_message", h ? h.to.panelId : args.session, args.message, { purpose: "message" }, h);
        return `Drafted. Your user sees it under your message and decides whether to send it to "${title}"; if it's busy, it gets it after its current turn.${h ? " That carries out the handoff." : ""} Don't repeat the message in your message.`;
      },
    },
    {
      name: "plan_handoff",
      description: `When your user asks you to pass something on once a session finishes ("when the auth session is done, tell the UI session to use the new endpoint"), plan a handoff instead of drafting the message now. Rails wakes you each time \`from\` ends a turn without asking your user anything; you then check its work is done and draft the message for \`to\` with suggest_message, passing the handoff's id. \`note\` is what to pass on, in your user's words (at most ${HANDOFF_NOTE_MAX} characters). It waits at most ${HANDOFF_TTL_MS / 3_600_000} hours and is cancelled if either session ends; your user sees it in your panel and can cancel it. Resolves to its id.`,
      params: Type.Object({
        from: Type.String({ description: "The session to wait for: its id from list_sessions or project_board, or its title." }),
        to: Type.String({ description: "The session to pass it on to: its id or its title." }),
        note: Type.String({ description: "What to pass on once `from` is done, in your user's words." }),
      }),
      effect: "act",
      log: { doing: () => "Planning a handoff", done: (calls) => (calls.length > 1 ? `planned ${calls.length} handoffs` : "planned a handoff") },
      run: async (args, ctx) => {
        const project = coordinating(ctx, "plan_handoff");
        const [from, to] = await Promise.all([findOpen(project, args.from), findOpen(project, args.to)]);
        const h = planHandoff(ctx.sprocketId, { panel: from, title: from.title }, { panel: to, title: to.title }, args.note);
        return `Planned (id ${h.id.slice(0, 8)}). Rails wakes you when "${from.title}" finishes a turn. Tell your user in a sentence; they see it in your panel.`;
      },
    },
    {
      name: "set_owner",
      description: `Record which files or folders a session owns, when your user tells you ("Claude owns src/engine and index.html"). Paths are relative to the project (at most ${MAX_OWNED}); this replaces what that session owned, and an empty list clears it. Owners are listed in your instructions: send your user's requests about those files to their owner, and Rails wakes you when another session changes them. Your user sees owners in your panel.`,
      params: Type.Object({
        session,
        paths: Type.Array(Type.String(), { description: "Files or folders, relative to the project, e.g. src/engine." }),
      }),
      effect: "act",
      log: { doing: () => "Recording owners", done: (calls) => (calls.length > 1 ? `recorded ${calls.length} owners` : "recorded an owner") },
      run: async (args, ctx) => {
        const project = coordinating(ctx, "set_owner");
        const found = await findOpen(project, args.session);
        const paths = setOwner(project, found, args.paths);
        return paths.length ? `Recorded: "${found.title}" owns ${paths.join(", ")}.` : `"${found.title}" owns nothing now.`;
      },
    },
    {
      name: "cancel_handoff",
      description: "Cancel one of your pending handoffs, when your user asks or it no longer makes sense. They're listed in your instructions with their ids.",
      params: Type.Object({ handoff: Type.String({ description: "The handoff's id." }) }),
      effect: "act",
      log: { doing: () => "Cancelling a handoff", done: () => "cancelled a handoff" },
      run: async (args, ctx) => {
        coordinating(ctx, "cancel_handoff");
        const h = findHandoff(ctx.sprocketId, args.handoff);
        dropHandoff(h);
        return `Cancelled the handoff from "${h.from.title}" to "${h.to.title}".`;
      },
    },
  ];
}
