# ADR 0023: Chat turns: runs as rows, passing the turn, asking the user

Status: accepted. It replaces how turns pass in team chats (ADR 0022) and the rule that one run saves one reply
(ADR 0006, 0021). Everything else in those ADRs stands.

Team chats passed the turn by reading replies: an `@Name`, a question that starts or ends with a name, and for a
while the decision model's guess. Models forgot the @, tacked "@Pam" onto a question that already named Pam, or
passed the turn with a thanks. Who answered the user was a pile of rules too: names with or without an @, words
like "everyone", the member whose last reply had a question mark. Runs and team rounds lived in memory, so a
restart lost them, and a run could post only one message.

So who speaks next should be data, not a reading of prose. Runs become rows. A member hands a teammate the next
step with a capability, not with prose. A member asks the user with options to tap, and its run waits for the
answer. A run can post several messages. Rails keeps its single process and SQLite.

Decisions:
- **A run is a row** (`sprocket_runs`): the chat, the Sprocket, a status (queued, running, waiting, done,
  failed or cancelled), what started it (`user`, `pass` or `event`), the message that did, who passed the turn
  and how many passes led to it (`hop`). One engine (`runs.ts`) runs every chat's turns. It starts queued runs
  oldest first: one at a time per Sprocket (ADR 0021), one at a time per chat, and two at once in all (ADR 0006).
  Asking for a run while one is queued for that Sprocket in that chat changes nothing, so a burst of events wakes
  a Coordinator once more, not once per event. When the server starts, runs it was in the middle of become
  failed, with a notice in their chat, and queued runs start.
- **Who answers your message in a team:** the members it @mentions (the composer completes names, and
  `@everyone` picks every member), in the order it mentions them. Otherwise a tapped option goes to whoever asked
  (below); then the decision model's pick if one is set (ADR 0012), which sees the questions waiting for your
  answer, so a typed answer reaches the asker and "Love it. Nova, who…" reaches Nova; without it, the members
  whose questions wait; then the lead. A name without an @
  picks nobody: "…reference pam" doesn't wake Pam. A new message from you cancels the turns still queued in that
  chat, and the reply being written is still saved.
- **Passing the turn** is a capability, `pass_turn({ to, note })`, offered only in team chats. The member writes its
  message as usual (its own part of the work, naming teammates plainly, no @), then calls it with a few words on
  what the teammate should do. The run ends right after that script, with no further model call. Rails adds a pass
  line to the chat (`→ Pam · check the draft`) and queues Pam's run (trigger `pass`, `hop` plus one); Pam reads the
  note as Rails' line in the chat. The note is required, because a model would sometimes pass without writing
  anything, and the teammate then had no idea what was asked. An @ in a reply passes nothing. The capability
  refuses:
  - a member who isn't in the team, or the member itself;
  - a pass past 10 in a chain (`TEAM_TURNS_MAX`). The member is told to post its result, and you decide what's
    next;
  - a member whose turn already comes (after `@everyone`, the lead would otherwise hand its own question to the
    next member, who was going to answer anyway). The member is told who answers after it;
  - a pass before the member has written anything this turn: models passed with only a note, and the teammate
    had nothing to check or go on.
  A refusal comes back to the member as the call's error, so it can still answer in the same run. Passing back to
  whoever passed it is allowed, so two members can talk it over: we first refused it, as Rakazo does, and a
  two-member team then stopped after two replies. The instructions say to pass back only with something new for
  them, never just to report back, and the 10-pass cap stops a loop.
- **A forgotten pass gets one reminder.** When a member's turn ends without a pass and its last message asks a
  teammate something (a question with their name in it, or a sentence that starts with it: "Fred, draft step 2"),
  Rails tells the member once, as its own note, and gives it one more model call to pass the turn or leave it.
  What it writes then isn't posted. The member decides; Rails only reads the names to know when to remind it. A
  teammate whose turn already comes, or one at the cap, isn't a reason to remind.
- **Asking the user** is a capability, `ask_user({ question, options })`, with two to four short options, or
  none for an open question ("What does the app do?"), offered in direct and team chats. Options are answers you'd
  send as they are, never ways to answer ("Tell you the vibe"). The question shows as the member's message, with
  the options as buttons under it, until it's answered. The run ends right after and stays `waiting`. Tapping an
  option sends it as your message, to the asker. A typed message goes where the decision model says (to the asker,
  if it answers the question), or without one to the members whose questions wait. Whoever it goes to has their
  question marked answered; a question passed over keeps waiting. It replaces guessing that a reply ending in "?"
  was meant for you.
- **A run may post several messages** in direct and team chats. Text the model writes before a tool call is
  posted as its own message as soon as that model call ends, and the final text is another. `send_message({ text })`
  posts one right away without ending the turn (at most 5 per run), for a heads-up or several messages in a row:
  models asked for "two messages in a row" otherwise printed them from a script, which nobody sees. A text that
  says what the run already posted (models repeat their message, reworded a little, after a refused pass) isn't
  posted again. Each message is
  dated when it's posted, so a message you send meanwhile sits between them. Bubbles per paragraph stay
  (`bubbles.ts`). A project chat keeps one reply per run, dated at the run's start, as before: the Coordinator
  check (`scripts/coordinator-check`) measures that chat.
- **What shows:** one face at a time, for the running member, else the first queued (ADR 0022's faces). The pass
  line is a muted 13px row (`→`, the member's 16px face and name, then the note). Waiting runs show nothing
  beyond their buttons.
- **Storage:** `sprocket_runs`, plus `run_id`, `pass_to` and `ask` (JSON: question, options, answer) on
  `sprocket_messages`. A pass line is a message with the author `pass` and the note as its text. Each message a run
  posts keeps the tool steps before it, and its last one those after it too, so later runs see what it looked at,
  in order (ADR 0008).

Consequences:
- Who answers is predictable: the @mentions, a tapped option, the decision model's pick, an open question, then
  the lead. A model can still forget to call `pass_turn`; the reminder catches the usual case (it asked a teammate
  by name), at the cost of one model call when it fires, and otherwise the round ends and you pick it up.
- Members can argue back and forth on their own, up to 10 passes.
- Restarting the server no longer loses a team's queue, and a run that was cut off says so instead of vanishing.
- `@everyone` is the only way to ask every member at once without a decision model; "everyone, …" without the
  @ goes to the lead.
