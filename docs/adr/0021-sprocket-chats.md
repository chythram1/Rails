# ADR 0021: A direct chat per Sprocket, and a chat per project

Status: accepted (changes the one chat of ADR 0005, 0006 and 0009; team chats are ADR 0022; ADR 0023 makes runs rows
that may post several messages outside the project chat).

A Sprocket had one chat. For a Coordinator that chat held everything: what the user asked it, Rails' events
(sessions that wait, overlaps, handoffs, agents' messages) and the suggestion cards under them. A question like
"what should we do next?" landed between dozens of events, every run read them all back, and there was no way
to start over except moving the Sprocket to another project, which deleted the chat.

Decisions:
- **Two kinds of chat.** Every Sprocket has one **direct chat**, made with it: the user and the Sprocket. An
  attached Sprocket also has its project's **project chat**, made when it's attached (a project has one Sprocket,
  ADR 0016, so one project chat). Rails' events, and its notices about them, go to the project chat only. The user
  can write in both. A later ADR adds **team chats** (several Sprockets with the user, many of them); the storage
  is built for that: chats are rows (`sprocket_chats`: id, kind, the Sprocket that answers, the project for a
  project chat, when it was last cleared), and messages carry their chat's id.
- **Where they show.** The workspace's side panel shows the project chat. The Sprockets page lists each Sprocket
  once, under its project's heading; an attached one opens on its project chat, with its direct chat as a tab
  beside it in the chat's header. Unattached Sprockets (General) have their direct chat only.
- **Runs are per chat.** A run reads its own chat: its last 40 messages and the tool steps of its last 3 replies
  (ADR 0008), and its instructions say which chat it's in. A Sprocket answers one chat at a time, since its core
  memory and codemode store are shared; a request from another chat waits for the run to end. The hourly limit
  stays per Sprocket.
- **The direct chat can look at the project chat.** Events never land in it, but an attached Sprocket there has a
  `project_chat` capability: the project chat's recent messages, events in the short form runs read. It can answer
  "what did I miss?" without the events in every run. Its other capabilities are the same in both chats, so it can
  draft a reply for a session from either; the card shows under that reply.
- **Clearing a chat** deletes its messages. Suggestions still waiting in it expire ("The chat was cleared."), since
  agents' draft history (ADR 0018) reads them; a reply being written when it's cleared is dropped. Core memory, the
  codemode store, handoffs and owners stay: clearing is "start the conversation over", not "forget". The user
  confirms it in a dialog.
- **Moving or detaching** a Sprocket deletes its project chat (what ADR 0006 did with its one chat) and keeps its
  direct chat. Deleting a Sprocket deletes both.
- **Existing chats:** an attached Sprocket's chat becomes its project chat, since that's where its events are; an
  unattached Sprocket's becomes its direct chat.
- **API:** `GET` and `POST /api/chats/:id/messages`, and `DELETE /api/chats/:id/messages` to clear. A Sprocket lists
  its chats (id, last message, whether it's replying there, how many suggestions wait there). `sprockets.typing` and
  `sprockets.activity` carry the chat's id. The old `/api/sprockets/:id/messages` routes go; the test-run harness
  and the coordinator-check use the project chat.

Consequences:
- A Coordinator's project chat holds only project work, so its runs read fewer unrelated messages; talk with the
  user moves to the direct chat.
- Team chats need their own decisions (who answers a message, and how Sprockets keep from replying to each other
  without end), but no change to how chats are stored.
