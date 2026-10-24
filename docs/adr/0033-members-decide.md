# ADR 0033: Team chats: every member hears every message and decides

Status: accepted. It replaces who answers in a team chat (ADR 0022's "Who answers", "Passing the turn" and "No
endless replies"; ADR 0023's "Who answers your message in a team", "Passing the turn", "A forgotten pass gets one
reminder" and both amendments) and ADR 0006's two runs at once. Runs as rows, `ask_user`, several messages per run
and everything else in ADR 0022 and 0023 stand.

Teams gave the user's message to one member (the lead, an @mention, or whoever asked a question) and let members
hand each other the turn with `pass_turn`. Getting the whole team to answer took rules that read English: "everyone",
"you all" and "the team" (`FOR_ALL`), thanks and greetings (`SMALL_TALK`), a teammate's name in a question
(`askedTeammates`), and reminders built on them. Each rule missed something ("both of you", "the three of you",
another language), and members read Rails' turn notes back to the user ("Pam has the next turn, so I'm leaving it
there"). The user had to learn the rules to use a team.

A black-box look at another product's group chats with bots (2026-10-24) showed a model where nothing in code reads
the message: every bot became active on every message, at once, and only those with something to say wrote ("Becky
and Chandler are working…", then only Chandler answered "Chandler, what's our cash floor?"). Bots answered each
other without the user writing again, a name in a message was a reference and woke nobody in particular, and a new
message didn't stop answers being written: they posted, then corrected themselves.

Decisions:
- **Every member wakes.** The user's message wakes every member of the team, and each run decides for itself:
  write, or stay quiet. Nothing in code reads the message's words. The exceptions are the unambiguous ones:
  - `@Name` wakes only the members it names (and answers their waiting questions);
  - a tapped option wakes only the member who asked it.
  A typed message answers every waiting question: whoever asked reads it and decides whether it answers them.
  `@everyone` is a plain message (everyone wakes anyway).
- **Staying quiet.** A member with nothing to add replies with exactly `(quiet)` (the Coordinator's convention, ADR
  0009), and nothing is posted. Members are told to write only when the message is for them or they add something
  their teammates won't, and never to talk about Rails, turns or who is answering.
- **Members' messages wake the others.** When a member's run posts something, the other members wake (only those it
  @mentions, if it mentions any), so a teammate asked something answers without the user writing again. A run that
  ends asking the user (`ask_user`) wakes nobody: the question is for the user. Each wake is one level deeper than
  the run that caused it (`hop`); a user's message is level 0, and members stop waking each other at level
  `TEAM_TURNS_MAX` (4). A quiet run wakes nobody, so a chain ends on its own once nobody has anything to add.
- **Coalescing.** A member has at most one queued run per chat, and it reads everything that arrived meanwhile, so
  two teammates writing at once wake each member once, not twice. The user's message replaces a member's queued
  run with one at level 0.
- **A new message lets work finish.** A message from the user cancels nothing: replies being written post, and each
  member wakes again to read the new message and correct itself if it needs to. Some replies can be stale for a
  moment; none is thrown away.
- **Members run in parallel.** A chat no longer has one run at a time: each member of a team can run at once (still
  one run at a time per Sprocket, ADR 0021). The server runs up to 6 at once, up from 2, so a team of four can
  answer together. Members running at the same time can't see each other's replies; they're told who else is
  answering, and some overlap is accepted.
- **What a member reads.** Its note before it writes says only facts: what woke it (the user's message or a
  teammate's), who else is answering now, and the questions still waiting for the user. It isn't told what to do
  with them beyond the team's instructions.
- **No lead.** A team's members have an order (the first stands in front in its face, and the chat's settings list
  them in it), but no member is the lead, and no member is told it is. `pass_turn`, the pass line, the round
  reminders and the English-pattern rules are gone. Pass lines from before stay in the database and are hidden.
- **Limits.** The hourly limit per Sprocket (ADR 0006) counts runs that posted; a quiet run doesn't count, because
  it wakes nobody and so can't loop. Its tokens still count as usage.
- **What shows.** One icon at the bottom of the chat turns from one member into the next, round everyone thinking since
  the message (the outline morphs, flubber, and the colour fades across), and a line beside it names those still
  thinking, in the team's order ("Becky and Chandler are thinking…"). A member that finishes drops out of the line, not
  the icon, so nothing flickers; a member stays named for 800ms after it stops. A team has no typing dots or spin;
  direct chats keep them. Members' names in messages read as chips, with or without an @; a chip is a reference and
  wakes nobody.

Amendment (2026-10-24): greetings and thanks to everyone get an answer from each member who wants to give one. The
first instructions asked for one answer to small talk, and "Hello everyone" got only one.

Consequences:
- Each message costs one run per member (four in a team of four), and each posted reply up to one more per
  teammate. Quiet runs are short, but they read the whole chat.
- Who answers is the members' judgment, so it can be wrong: two members can both answer a thanks, or nobody can
  answer a vague message. `@Name` always reaches who it names.
- The user never needs to know a rule to be answered by the right member.
- Two members answering at once can say the same thing; the instructions and different roles keep it rare.
- Members talk to each other in the chat, where the user sees it, up to four levels after each user message.
