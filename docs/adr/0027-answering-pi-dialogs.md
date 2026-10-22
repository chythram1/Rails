# ADR 0027: Rails answers pi's dialogs where it can

Status: accepted. It changes ADR 0010's "Rails can't answer dialogs" for pi.

In every test run from 4 to 7 the Coordinator suggested the right answer to a pi question dialog, and the user
still had to open pi's panel to pick it: Rails never types into a panel, and pi has no question tool of its own.
Extensions add them, each with its own dialog, so there's no one place to answer. Rails' own extension runs in
the same pi process as theirs, though, and can reach two things they share.

Decisions:
- **Three layers, safest first:**
  1. **pi's own dialogs** (`ctx.ui.select` and `ctx.ui.input`, whichever extension calls them): the Rails extension
     wraps them on pi's shared `ui` at session start (once, marked, so nothing wraps twice). A wrapped dialog gets
     an id, reported with pi's `ui_prompt_start`, and an abort signal of its own: an answer from Rails closes the
     dialog through that signal and is returned in its place. The extension's own signal still closes it.
  2. **Extensions that take answers from outside:** `@juicesharp/rpiv-ask-user-question` (2.13.9 and later)
     listens for `rpiv:ask-user:answer` on pi's event bus, by tool call id, and replies on
     `rpiv:ask-user:answer-result`. The Rails extension hears its `rpiv:ask-user:prompt` event and answers
     through that contract. Older versions don't listen: after 3 s Rails says to answer in the panel. Another
     extension that offers such a contract gets an adapter the same way.
  3. **Everything else** (`ui.custom` dialogs without a contract, `confirm`, approvals) is answered in the panel,
     as before.
- **What can be sent:** a select's option (the draft must match one, case, quotes, end punctuation and
  "(Recommended)" aside), an input's text, or a single-question questionnaire's option or typed answer.
  Questionnaires with several questions are answered in the panel. The match is made when the Coordinator
  drafts (`dialogAnswer`), stored on the suggestion (`dialog`), and the card shows Send next to Open panel.
- **First answer wins.** An answer travels the pi inbox Rails already uses for replies; the extension gives it
  only to the dialog still open with that id and says whether it took it. An answer the user gave in the panel
  first expires the draft (the session moved on), and a late one is refused ("The dialog has closed.").
- **Reports go in order.** The extension now sends its reports one at a time: sent side by side, a question tool's
  report could land after its dialog's, and Rails took the session for moving on (seen in the live check).

Consequences:
- pi's dialogs behave as before for the user; wrapping `ui` touches every select and input pi shows, so a change
  in pi's `ui` shape turns the wrapping off (it checks first) rather than breaking dialogs.
- Rails depends on one third-party contract (rpiv's), versioned by its channel names; a breaking change there
  arrives as a new channel, and Rails falls back to the panel until it's adapted.
- Answering several questions at once, Claude Code's question dialog (its hooks can't hold a dialog open for an
  answer), and approvals stay open. A standard answer API in pi itself would replace layers 1 and 2: proposed
  upstream.

## Addendum: Codex's questions

Codex 0.163 asks with `request_user_input` while its turn goes on: an `agentMessage` item with
`delivery: "async"` and `questions: [{title, options}]`, shown as "? 1 question" in its panel. The turn stays
active (it sleeps in a tool while it waits), and its panel answers by steering that turn. Rails heard the item and
ignored it, so these questions never reached the Coordinator (an open item since test run 1).

- Rails reads it as a question wait, with the turn's id as the question's id (`kind: "steer"`). Codex's tool calls
  while it waits don't end the wait, nor expire a drafted answer; a prompt or the turn's end does.
- Send answers with `turn/steer {threadId, expectedTurnId, input}`, the text being the option's label when the
  draft names one. A turn that ended meanwhile gets the answer as the next message (`thread/queue/add`):
  `thread/queue/add` alone waits for the turn to end, and Codex had answered itself by then (verified live).
- Codex's approvals stay the user's, in the panel (ADR 0026).
