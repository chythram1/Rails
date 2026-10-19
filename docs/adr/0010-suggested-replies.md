# ADR 0010: Coordinators suggest replies; the user sends them

Status: accepted (Sprockets step 3, part 2 of "unblock waiting sessions"; builds on ADR 0009).

A Coordinator that only says what a waiting session needs still leaves the user to switch to the panel and
type. The next step is to draft the answer and let the user send it from wherever they are (the chat, a
phone), with one tap. It's also the first time Rails puts text into a session, so the rules for that are
set here.

Decisions:
- **Suggestions, not messages.** A Coordinator's run can call `suggest_reply {session, reply}` (an `act`
  capability, Coordinators only, checked when it's called). It creates a suggestion shown under the reply the
  run saves; a run that saves no reply drops its suggestions. Nothing reaches a session until the user sends
  it, so a Sprocket never acts in a session on its own yet. When the user asks a Coordinator to "tell it …",
  it drafts a **message** instead (`suggest_message`, below).
- **Two kinds, by the session's state when it's suggested** (`suggestions.ts`):
  - **reply**: the session's turn ended (or failed): the user can edit the text, then Send or Dismiss;
  - **answer**: the session waits on a question in a dialog (Claude Code's AskUserQuestion, a pi question
    tool) or a form: the card shows the suggested option with "Open panel", and the user picks it there.
    Rails never types into a panel, so it can't answer dialogs itself (automatic answers through hooks may
    come later).
  - Never for a working session, a permission prompt, or any other dialog a pi extension shows (it may be an
    approval): those stay the user's to answer in the panel.
  - **message** (`suggest_message`, added after the user's first tries): something the user asked the
    Coordinator to pass on. Unlike an answer it doesn't belong to a moment, so it doesn't expire when the
    session moves on (only when it ends or its panel closes), and it can be sent whatever the session is doing:
    a busy session (working, or waiting on a dialog) gets it in its own queue, after its current turn. Each
    agent queues by itself: Claude Code's message socket, Codex's `thread/queue/add`, and pi's follow-up queue
    (the extension uses it only for messages, never for answers). The card then says "Queued for …".
    Treating both as answers made a "tell it to stop" request into an un-sendable dialog answer while the
    session had a question open, and dropped it as soon as the session moved on.
- **Suggestions go stale.** One per session per Coordinator (a newer one replaces the older). Anything the
  session does (a prompt, a tool, the dialog answered, the session ending, the panel closing) expires its
  pending suggestions. Sending checks everything again: the panel is open and in the Coordinator's project,
  and the session isn't working, waiting on something else or gone; a failed send can be retried.
- **Delivery** (`bridge/deliver.ts`) uses each agent's own way in, which starts a turn on an idle session:
  - Claude Code: its message socket. Claude Code presents those messages as coming from "another Claude
    session … not typed by your user" and treats them as a teammate's request (it won't count them as approval
    for a pending prompt). The reply starts with one line, "From your user, sent with Rails:", so the session
    and its transcript know whose answer it is.
  - pi: the Rails extension long-polls `GET /bridge/<panel>/pi/inbox` (held up to 25 s, panel token) and
    hands the text to `pi.sendUserMessage` only if pi is idle; pi shows it as the user's prompt. The extension
    then says whether it did (`POST /bridge/<panel>/pi/delivered`), and only that counts as sent: a reply lost
    on the way, or one that arrived as pi started on something else, shows as not sent.
  - Codex: `thread/queue/add` on its daemon, shown as the user's message.
  The send's outcome (sent, or failed and why) is shown on the card; the agent's reaction is in its panel.

Consequences:
- The bridge's waiting state treats a question reported twice (Claude Code's question then its permission
  check for the same tool; pi's question tool then its dialog) as one question.
- Sessions opened before Rails could see them (no message socket, no extension) can't be sent replies; the
  card says so and the user replies in the panel.
- Codex delivery is covered by tests against the protocol only: it hasn't been run against a live Codex here.
