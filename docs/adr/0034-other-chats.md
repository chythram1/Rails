# ADR 0034: A Sprocket sees its other chats

Status: accepted. It changes ADR 0021's "Runs are per chat": a run still answers its own chat, from that chat's last
40 messages, but also reads the latest of the Sprocket's other chats.

A Sprocket has several chats: its direct chat, its project's chat if it's attached, and each team it's in. Each run
read only its own chat, and core memory (the `remember` tool) was the one thing shared between them. Told "the code
is 53" in its direct chat, a Sprocket asked "what's the code?" in a team didn't know it. Memory didn't cover it
either: its instructions kept it for "preferences and how they like to work" and said "never store secrets, code or
details of one project". "Code" there meant source code, but models read it as a ban on codes, and one answered "I
won't retain or repeat secret codes". On every Sprocket in the dev home the sheet was empty.

In the reference group chat app, each bot answered in the group with what it was told in its direct chat, and in
its direct chat with what was said in the group. Another bot never saw it: asked for a code only Pip had been told,
Rex said nobody had told him one and he wouldn't make one up.

## Decision

- **Each run reads its other chats.** Right before the messages it answers, a run gets a note from Rails with the
  latest 20 messages of each of its other chats, the 4 most recently active of them, oldest first, each clipped to
  300 characters and marked with how long ago it was written (`elsewhere` in `prompt.ts`). The note says they
  aren't this chat, that others here may not have seen them, and that what the user said there holds here too unless
  they've said otherwise since.
- **Only its own chats.** A Sprocket's direct chat, its project chat (as its Coordinator) and the teams it's a
  member of. Another Sprocket's direct chat never shows, so a team member doesn't learn what the user told a
  teammate alone, except what that teammate says in the team.
- **Messages only.** The user's and the Sprockets' messages; not Rails' events and notices, cards or approvals. The
  direct chat still reaches the project chat's events through `project_chat` (ADR 0021).
- **Clearing a chat clears it here too.** A cleared chat has no messages to show, so "start the conversation over"
  holds in the other chats as well. Core memory stays, as before.
- **Memory keeps what the user asks it to.** The instructions now say to save anything the user asks it to remember
  (a number, a code, a name, a date, a fact) as soon as they ask, as well as their preferences, and that the sheet is
  the same in all its chats. It refuses only passwords, API keys and tokens, and source code.

## Consequences

- A fact from one chat reaches another for as long as it's among that chat's latest 20 messages; for longer, it
  has to be in core memory.
- Every run outside a Sprocket's only chat is longer: up to 80 short messages, about 1,000 to 2,500 tokens. The note
  sits after the older messages, so a provider's prompt cache still covers those.
- A Sprocket may repeat in a team what its user told it alone, if asked there. That's the user's own chat with
  their own Sprocket, as in the reference app.
- The Coordinator check (`scripts/coordinator-check`) replays situations on a Sprocket with no other chats, so it
  doesn't measure this.
