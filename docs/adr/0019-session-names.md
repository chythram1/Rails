# ADR 0019: Session names

Status: accepted (builds on ADR 0001's "transcripts are the source of truth" and ADR 0018).

Rails showed each session under the title its agent gave it. pi's title is the session's first prompt ("Read
BRIEF.md. Build src/ui/hud.js: a…"), Claude Code rewrites its own as the session goes on, and Codex's is its
first message or a name it generates. Since ADR 0018 those titles aren't only for the user: agents find each
other by them (`message(session: …)`) and the delivered text names its sender by one. A long or shifting title
makes all of that clumsy, and a Coordinator's notes about "Gear turning loop engine" go stale when Claude renames
the session.

Decisions:
- **The user can name a session in Rails**, from the session's menu in the sidebar ("Rename…") or by
  double-clicking its tab. The name replaces the agent's title wherever Rails shows one: tabs, the sidebar, the
  Coordinator's board and tools, `neighbours` and `message` (`sessionTitle` in `titles.ts`, `names.ts`). An
  empty name clears it and brings the agent's title back.
- **Rails keeps the name** in its own database (`session_names`, by provider and session id), so it outlives the
  panel: closing a session and opening it again keeps its name. Rails never writes the name into a transcript
  or tells the agent to rename itself (ADR 0001): the agent's TUI keeps its own title.
- **Which title wins:** the Rails name, then the agent's own title (the user's `/rename` or `/name` in the agent,
  or the agent's generated title), then the first prompt. Rails also reads Codex's thread names
  (`~/.codex/session_index.jsonl`) and pi's cleared `/name`, which it missed before (`providers.md`).
- **One line, at most 40 characters** (`SESSION_NAME_MAX`, about what a tab or a sidebar row shows), and **unique
  in the project, ignoring case**, against every other session's title, so "ui" means one session to the user and
  to the agents. A clash is refused with the other session's title.
- **Only sessions get names.** Shells have no session to name, and a new Codex panel can be named once Rails
  knows its thread. Records made before a rename (drafts, handoffs, decisions) keep the title they were made
  with.
