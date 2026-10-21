# ADR 0022: Team chats

Status: accepted (builds on ADR 0021's chats).

ADR 0021 gave every Sprocket its direct chat and a project its project chat, and left team chats for later: the
user and several Sprockets in one conversation, so Sprockets that look after different things (two projects, a
project and the docs) can work something out together. Two questions had to be settled first: who answers a
message, and how Sprockets keep from replying to each other without end.

Decisions:
- **A team** has a name and two to four Sprockets, attached to a project or not. The first is its **lead** (★).
  A Sprocket can be in any number of teams, and teams belong to no project. There can be any number of teams.
- **Who answers.** The user's message goes to the lead, unless it @mentions members ("@Doc Keeper"): then they
  answer, in the order they're mentioned. A reply that @mentions other members passes the turn to them, after it.
  A Sprocket mentioning itself, or someone already waiting their turn, changes nothing. A mention is the member's
  name after `@`, so two members of a team can't share a name.
- **No endless replies.** Only the user starts a **round**: events never land in a team. A round ends when a
  reply mentions nobody, or after 6 turns. Rails then says it paused, and the user's next message starts a new
  round. A new message from the user also replaces the turns still waiting in a round, once the reply being
  written is saved. A team has one reply going at a time, and the hourly limit per Sprocket (ADR 0006) counts
  every turn.
- **Runs.** A member's run reads the team's last 40 messages: its own replies as its own, the user's as theirs,
  and the other members' marked with their names. Only its own tool steps are replayed (ADR 0008). Its
  instructions name the team and its members (the lead marked, the start of each one's description), and say how
  mentions work and that Rails stops after 6 turns. A Sprocket answers one chat at a time (ADR 0021), so a member
  busy elsewhere takes its turn when it's done.
- **Tools** are those of the member's direct chat (ADR 0021): its project's board, files and git, `project_chat`,
  its memory and, for a Coordinator, drafts for its own project's sessions, shown under its message.
- **Where they show.** The Sprockets page lists teams first, under a "Teams" heading: the members' characters
  overlapping, the name, and the last line with who wrote it. The list's New button (beside the search) makes a
  Sprocket or a team: a dialog with the name and four member slots, the first one the lead's. The chat's `…` menu
  edits the team, clears its chat (ADR 0021) or deletes it. Typing `@` in a team's composer suggests the members
  whose names fit what follows it.
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
- One message to a team can cost up to 6 runs; the user sees each one as it's written.
- Sprockets pass work along by name, which the user can follow in the chat, rather than through a hidden tool.
- A team can't wake on Rails' events or hold a Coordinator's events; those stay in project chats, which a member
  reads with `project_chat`.
