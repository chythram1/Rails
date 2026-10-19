# ADR 0015: Handoffs

Status: accepted (builds on ADR 0009, 0010 and 0014).

Work in one session often waits on another: the UI session needs the endpoint the auth session is writing. The
user knows that and has to remember to pass it on when the first one is done; no agent can, since none of them
sees the other. A project's Coordinator can, if the user tells it what to wait for. This finishes the second
Sprocket job (coordinate), with ADR 0014's overlap warnings.

Decisions:
- **The user asks for it in the Coordinator's chat** ("when the auth session is done, tell the UI session to use
  the new endpoint"), and the Coordinator plans it with `plan_handoff` (from, to, a note of at most 300
  characters). Rails doesn't guess dependencies between sessions; sessions don't report them (yet).
- **Rails wakes the Coordinator each time the first session ends a turn without asking the user anything** (not
  a turn that ends with a question, not a failed one; `watches.ts`). The event names the receiving session and
  the note. The Coordinator checks the work is really done and drafts the message with `suggest_message`,
  passing the handoff's id, which carries it out. If it isn't done, it replies (quiet) and waits for the next
  turn end.
- **The user sends the message** (ADR 0010): nothing reaches a session until they do.
- **A handoff waits at most 24 hours** (`HANDOFF_TTL_MS`), and is cancelled when either session ends or its
  panel closes, or as soon as its Sprocket stops being the project's Coordinator (switched off, replaced, moved
  or deleted). Each of those leaves a line in the chat, except when the Sprocket moved or was deleted (its chat
  is gone). A handoff cancelled while the Coordinator is drafting its message gets no draft. At most 10 wait
  per Coordinator.
- **Pending handoffs show on the Coordinator's job page**, under its rules, each with Cancel
  (`POST /api/handoffs/:id/cancel`). They're also in its instructions, with their ids, so it can list or cancel
  them (`cancel_handoff`).
- **Stored in the `handoffs` table** with its sessions' titles, kept current as the sessions report prompts and
  turn ends (a handoff is often planned before a session has a title of its own). A turn the user stopped
  isn't finished, so it doesn't count.

Consequences:
- A session that finishes in several turns wakes the Coordinator at each; each run is short, and the runaway
  guards (ADR 0008) still apply.
- A session that quits, or whose panel closes, cancels the handoffs still waiting on it, even just after a turn
  end that woke the Coordinator (the chat says so). Usually the Coordinator has drafted the message by then.
- Later, sessions could plan handoffs themselves (a `rails` command or an MCP tool), and trusted handoffs could
  send without a tap.
