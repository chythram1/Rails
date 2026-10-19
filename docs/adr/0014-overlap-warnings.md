# ADR 0014: Overlap warnings

Status: accepted (builds on ADR 0007, 0009 and 0010).

Several sessions in one project share its folder. Two of them changing the same file at about the same time may
be working against each other: one undoes or breaks what the other relies on, or their changes end up in one
commit. Neither agent can see the other; Rails sees both. This is the second Sprocket job (coordinate), after
unblocking waiting sessions.

Decisions:
- **An overlap** is two live sessions in a project (panels open, sessions not ended) that both changed a file
  within the last 30 minutes (`OVERLAP_MS`, a code constant to tune). It's computed from the board's edits, which
  now keep when each file was last changed (`sharedFiles` in `bridge/board.ts`).
- **Only edits the agents report count:** Claude Code's edit tools (PostToolUse, which fires only after a tool
  worked), pi's `edit` and `write` (the extension now reports them again when they end without an error; the call itself,
  which comes before another extension's approval, doesn't count),
  Codex's file changes (not failed or declined ones). Files changed by shell commands weren't seen at first; ADR
  0016 adds them, and an edit to files another session owns.
- **Both tabs show it**, in every project, with or without a Coordinator: a small amber warning that names the
  other session and the files (`panels.overlaps`). It goes when the window passes, a session ends or a panel
  closes.
- **The Coordinator judges it.** In a project with a Coordinator, an overlap wakes it for the session that changed
  the file second, the one stepping on the other's work, with an event naming the other sessions and the files.
  It looks at both sessions and their changes, replies (quiet) when it's harmless (they changed unrelated parts,
  or one builds on the other's finished work), and otherwise tells the user what clashes and drafts a heads-up for
  that session with `suggest_message`. The user sends it (ADR 0010): warn only, nothing is blocked.
- **Few wakes:** a session's edits within 15 s go in one event (`BATCH_MS`), and a pair of sessions wakes the
  Coordinator once per file per window, whichever of them changed it last.

Consequences:
- Sequential work (one session builds on another's finished change within 30 minutes) costs one Coordinator run
  that ends "they don't clash". The window can shrink, or the event carry more, if that's frequent.
- Sessions in separate worktrees (not built yet) can't overlap on files; their clash is a merge, which this
  doesn't cover.
