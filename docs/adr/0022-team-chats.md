# ADR 0022: Team chats

Status: accepted (builds on ADR 0021's chats). ADR 0033 replaces who answers, the lead, passing the turn and what
ends a round (every member hears every message and decides). Before it, ADR 0023 replaced who answers the user, how a member passes the turn,
what ends a round, and what a reply is; the rest stands.

ADR 0021 gave every Sprocket its direct chat and a project its project chat, and left team chats for later: the
user and several Sprockets in one conversation, so Sprockets that look after different things (two projects, a
project and the docs) can work something out together. Two questions had to be settled first: who answers a
message, and how Sprockets keep from replying to each other without end.

Decisions:
- **A team** has a name and two to four Sprockets, attached to a project or not. The first is its **lead** (★).
  A Sprocket can be in any number of teams, and teams belong to no project. There can be any number of teams.
- **Who answers.** (The decision model's part is superseded: ADR 0023's amendment, 2026-10-23.) The user's message
  goes to the members it's for, in the order it names them:
  - those it names: @mentions ("@Doc Keeper", or the start of just one member's name, "@Doc") and whole names
    without an @ ("Pixel, what colour?"). A name always counts, with a decision model or without, so naming
    someone works the same either way (a name in passing, "what did Pixel mean?", picks Pixel too);
  - naming no one, those the **decision model** (ADR 0012, Settings → Models) says it's for: one yes-or-no
    question per member, with the team, the last 8 messages and the new one (it's for them if it names them,
    speaks to everyone, follows up on what they said last, or asks about their role). Those at 0.6 or more
    answer when the message speaks to everyone; otherwise only the likeliest, so two members
    whose roles both fit don't say the same thing. If none reach 0.6, the likeliest. A first evaluation on Jev got 14 of 16 test messages right in about 0.1 s.
    The user's message is in the team's chat at once; Rails says it's `routing` while the model judges
    (at most 6 s);
  - with no decision model, or when it fails: Rails' rules. Everyone when it says so
    ("everyone", "all of you"), the member whose last reply asked the user something (a question not @mentioning a teammate), or else the lead.
  The user wanted the lead to read every message and decide; the decision model does that job in a tenth of a
  second, where a run of the lead would take seconds and cost one more reply each time.
- **Passing the turn.** A reply that @mentions other members, or asks one a question by name ("Pixel, what would
  you ship?", "Agreed, Scout?", as models tend to write), passes the turn to them, after it. The lead has
  priority: mentioned with others, or by a reply while others wait, it goes first. A team shows whose turns are
  coming (`waiting`), so the chat can show them. A Sprocket mentioning itself, or someone already waiting their
  turn, changes nothing. Two members of a team can't share a name.
  Members are told to write @Name for every teammate they want an answer from (a question, a task, a hello that
  expects one back), and a plain name only when they don't. Models forget to hand the turn back in a conversation
  the user asked for ("talk about it for 8 turns"), so each member's run ends with a note from Rails (not saved):
  the user's latest message, how many replies came since, and to end with an @mention and a question while what
  the user asked for isn't done. Rails doesn't otherwise guess who a reply is for: a decision model once judged
  that after every reply that passed the turn to no one, but the decision model is optional, and a rule the
  members follow is simpler and the same with or without one.
- **No endless replies.** Only the user starts a **round**: events never land in a team. A round ends when a
  reply mentions nobody, or after 10 turns (so an 8-turn conversation fits). Rails then says it paused, and the user's next message starts a new
  round. A new message from the user also replaces the turns still waiting in a round, once the reply being
  written is saved. A team has one reply going at a time, and the hourly limit per Sprocket (ADR 0006) counts
  every turn.
- **Runs.** A member's run reads the team's last 40 messages: its own replies as its own, the user's as theirs,
  and the other members' marked with their names in brackets (a reply that starts with its own name that way, as
  models copy it, has it taken off). Only its own tool steps are replayed (ADR 0008). Its instructions name the
  team and its members (the lead marked, the start of each one's description), say how Rails picks who answers,
  to talk as one person in a group chat (its own role, not repeating the others), that only an @mention hands a
  teammate the turn (and when to use one: asking, handing over work, a hello that expects one back, the whole
  team by each name, a discussion the user asked for; not thanks or relaying what the user already asked), and that Rails stops after 10 turns. The lead is told it takes what's
  for the team in general and hands on what fits another member better. A Sprocket answers one chat at a time (ADR 0021), so a member
  busy elsewhere takes its turn when it's done.
- **A reply is everything a run writes** (here and in direct chats; a project chat keeps only the text of the run's
  last model message). Models write text between tool calls for the user to see (OpenAI's "commentary"),
  and some call a tool with nothing in it just to start another message; showing only the last text cut replies
  in half ("A good flow should *also* …") and lost the question that passed the turn. Each block is a paragraph,
  so a bubble. A message that has a final answer drops its own commentary, which models write as a draft of it.
  In a team, a reply ends with the message that hands a teammate the turn: text after that (past a tool call)
  was the model playing out the teammate's answer, which the teammate then gives itself.
- **Tools** are those of the member's direct chat (ADR 0021): its project's board, files and git, `project_chat`,
  its memory and, for a Coordinator, drafts for its own project's sessions, shown under its message.
- **Where they show.** The Sprockets page lists teams first, under a "Teams" heading: the members' characters
  overlapping, the name, and the last line with who wrote it. The list's New button (beside the search) makes a
  Sprocket or a team: a dialog with the name and four member slots, the first one the lead's. Once made, a team is
  changed (name, members, lead) or deleted in its settings panel, as a Sprocket is; the chat's Clear chat button
  clears its chat (ADR 0021). Typing `@` in a team's composer suggests the members whose names fit what follows it, and
  mentions of members read as chips. Each member's run of replies has its name over it and its face at its foot.
  One face at a time pops up at the bottom left: the member whose turn it is, once Rails knows it answers (never
  while Rails works out who), turning into dots as it writes. Members whose turns come later aren't shown, so the
  thread never has a row of faces that reads as part of a message.
- **Characters in the list stand still.** A team's row shows several faces, so a list of them blinking and bobbing
  is too busy; the gallery, the chats and the creator keep their motion.
- **When Sprockets go.** Deleting a Sprocket takes it out of its teams. Its messages there stay, shown as a deleted
  Sprocket's. If it led a team, the next member leads; a team with nobody left goes. Moving a Sprocket to another
  project changes nothing in its teams.
- **Storage:** a team is a row of `sprocket_chats` (kind `team`, its name, its lead in `sprocket_id`), with its
  members in `sprocket_chat_members` (chat, Sprocket, position). A message's `sprocket_id` is the Sprocket that wrote
  it. **API:** `GET` and `POST /api/teams`, `PUT` and `DELETE /api/teams/:id`; messages use ADR 0021's
  `/api/chats/:id/messages`.

Consequences:
- One message to a team can cost up to 10 runs; the user sees each one once it's written.
- With a decision model, a team's latest messages went to its provider as well as the model's (no longer: ADR
  0023's amendment).
- Who answers the user is a judgment, so it can be wrong; an @mention always reaches who it names. A member that
  forgets the @ ends the round; the user picks it up from there.
- Sprockets pass work along by name, which the user can follow in the chat, rather than through a hidden tool.
- A team can't wake on Rails' events or hold a Coordinator's events; those stay in project chats, which a member
  reads with `project_chat`.
