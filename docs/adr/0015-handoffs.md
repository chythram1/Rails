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
- **The user sends the message** (ADR 0010): nothing reaches a session until they do. It carries what the finished
  session said last, word for word, under the Coordinator's text (added after a test run, where a summary dropped a
  detail and caused a bug): the card shows it collapsed, and the Coordinator is told not to repeat it.
- **A handoff waits at most 24 hours** (`HANDOFF_TTL_MS`), and is cancelled when either session ends or its
  panel closes, or as soon as its Sprocket stops being the project's Coordinator (switched off, replaced, moved
  or deleted). Each of those leaves a line in the chat, except when the Sprocket moved or was deleted (its chat
  is gone). A handoff cancelled while the Coordinator is drafting its message gets no draft. At most 10 wait
  per Coordinator.
- **A handoff follows its sessions, not just their panels** (added after the second test run, after herdr's waits,
  which are pinned to the agent in a pane): it records each side's session when planned, and is cancelled when a
  session that was in use moves on to another in its panel (`/clear`, resuming another), since the new one isn't
  what the user meant. A side planned before its session was known takes the first one it shows, and so does one
  whose session never had a turn (Codex can start a thread it never uses; `followSessions` in `handoffs.ts`).
- **Pending handoffs show on the Coordinator's job page**, under its rules, each with Cancel
  (`POST /api/handoffs/:id/cancel`). They're also in its instructions, with their ids, so it can list or cancel
  them (`cancel_handoff`).
- **A handoff the session already carried out itself:** sessions can message each other (ADR 0018), and in test
  runs 4 to 6 a session told the other what the handoff was for mid-turn, so the handoff's draft said it again.
  When a handoff fires, its event shows the Coordinator the messages the finished session wrote to the other one
  since the handoff was planned (sent, or still waiting for the user); if they cover it, the Coordinator cancels
  the handoff and stays quiet, else it drafts only what they left out.
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
