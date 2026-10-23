# ADR 0009: Coordinators hear about sessions that wait for the user

Status: accepted (Sprockets step 3, part 1 of "unblock waiting sessions").

Until now a Sprocket only answered when written to, and everything it did (read git, read a session, sum up
the board) a session's own agent could do when asked. The slow part of running several agents is the user:
sessions stop and wait for an answer, or for "go on", while the user is in another panel or away. Sprockets
can see every session in a project and are always on, so their first job is to unblock those waits: tell the
user what a session needs and, in the following parts, suggest the answer and send it on the user's tap.

Decisions:
- **One Coordinator per project.** (Superseded by ADR 0016: a project now has one Sprocket, which is its
  Coordinator; the switch is gone.) A switch in a Sprocket's settings makes it its project's Coordinator,
  taking the role over from any other (the UI asks first); moving or detaching it ends the role. Only the
  Coordinator is woken by sessions, and later only it may message them. Other Sprockets in the project still
  read everything and report to the user when asked.
- **Watches decide in code when to wake it** (`watches.ts`), so idle projects cost nothing:
  - a session asks in a dialog or a form (Claude Code's AskUserQuestion, a pi question tool, Codex's request
    for input), or ends its turn with a question (`looksLikeQuestion`: the last sentence, or the line above
    the options it lists last, ends with a question mark or asks with "should I", "want me to", "let me know
    which"…, or that line ends with a colon after such an ask, as in "Should I go ahead? The choice is:"; earlier questions, code, URLs and pleasantries like "anything else?" don't count);
  - the user gets 20 s to answer first: anything the session does meanwhile (a prompt, a tool, the answer)
    means it's moving again, and nothing wakes;
  - one wake per wait (agents may report a wait twice), and at most one per session per minute (a sooner
    one waits for the minute to pass);
  - permission prompts never wake it, nor other dialogs pi extensions show (they may be approvals): Sprockets
    never answer those, and the tab's attention mark covers them. (Superseded by ADR 0026: they wake it after
    the same grace period, and it tells the user what they're for, drafting nothing.) pi has no question tool of its own, so a
    pi dialog is a question only when it opens while a tool whose input holds questions is running; the
    questions are read by their shape, whatever the tool is called (docs/providers.md). A question without
    options is open, and the Coordinator is told it's answered by typing.
- **Waits arrive as chat messages** (in the project's chat since ADR 0021) from Rails (author `event`), with the session, what it waits for (the
  dialog's questions and options, or the end of its last message) and a link to its panel. The model reads
  them as `[Rails event, not from your user]`, with the session's text quoted as data. The Coordinator's run
  replies as usual: which session, what it's asking, what it would answer and why. If the wait doesn't need
  the user after all, it replies `(quiet)` (or ends its reply with it): nothing is saved but a "nothing needed"
  mark on the event. Events that come in while it answers another wait for one run, which ends with a reminder listing
  them (not saved): in test run 6 such a run answered only the newest of two and left a session's go-ahead
  question without an answer or a mark.
- **The bridge keeps the end of final messages** (the first 500 and the last 1,500 characters), since a
  closing question is what says a session waits.
- **Not yet:** suggested answers the user sends with one tap (done in ADR 0010), automatic answers for rules the user trusts (through the hooks: Claude Code's PreToolUse
  `updatedInput.answers`, pi's `tool_call` block), a fast classifier judging every turn end in a shadow log,
  the workspace Sprocket panel, and muting a session. See `scratch/planning/step3-unblock.md`.

Consequences:
- Coordinators run without being written to, so their runs count against the same guards (12 steps per run,
  30 runs per hour, 2 at once). A busy project with a Coordinator costs model calls; a project without one
  costs nothing.
- The question check looks only at how a message ends, so rhetorical questions in an explanation don't
  wake anyone, but a question followed by more text ("Should I run the tests? They take 5 minutes.") is
  missed. A false alarm costs one run and ends as "nothing needed"; a miss is invisible. The shadow
  classifier is how misses will be measured.
