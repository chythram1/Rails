# ADR 0007: The bridge, so Rails (and Sprockets) see what sessions do

Status: accepted (Sprockets stage 2, part 2: seeing; messaging sessions comes next).

Sprockets are meant to coordinate the agent sessions of their project (ADR 0006). For that they need to
know what each session is doing without reading whole transcripts, which can be huge. Rails also had no
way to tell when an agent waits for the user, a signal lost with the old chat UI (ADR 0003).

Decisions:
- **Agents report to the server ("the bridge")**, wired in when Rails starts a panel, with command-line
  flags only, so the user's own agent settings are never touched:
  - **Claude Code:** `--settings` with HTTP hooks to `/bridge/<panelId>/claude/<Hook>`. SessionStart is a
    command hook (curl), because an HTTP SessionStart hook doesn't fire; it also reports the session's
    message socket for later.
  - **pi:** `--extension` with `bridge/pi/rails.ts`, which posts its events to `/bridge/<panelId>/pi/…`.
  - **Codex:** nothing on the command line: any `-c` flag makes Codex run without its shared app-server
    daemon. Rails is a client of that daemon (`bridge/codex.ts`) while Codex panels are open: it maps a new
    panel to the thread Codex starts in its folder (Codex picks the id, so new Codex panels now know their
    session), and subscribes to the thread's turns.
- **Each panel gets its own bridge token** (in its environment, not on the command line), which only lets
  it report about itself. It's not the access token, which still never reaches panels. Bridge requests are
  accepted from loopback only. Hooks never block an agent: if Rails is down, agents carry on.
- **One event shape for all three agents** (`bridge/events.ts`): start, prompt, tool (files, command),
  waiting, resumed, turn_end, failed, ended. Stored per panel in SQLite (`session_events`, the last 200),
  dropped when the panel closes.
- **The board** (`bridge/board.ts`) folds a panel's events into a card: status, what it was asked, files it
  changed, last command, last reply. Files changed by more than one session are listed too.
- **Needs attention:** a panel whose agent waits for a permission, a question or a form, or whose turn
  failed, shows a red dot in the sidebar and on its tab (`panels.attention`). Claude Code's idle reminders
  don't count; only real waits do.
- **Attached Sprockets can look** (`bridge/tools.ts`): `project_board`, `session_activity` (one session's
  last 25 events) and `git_status`, read-only and scoped to their project.

Consequences:
- Panels started before this (or outside Rails) don't report until they're reopened in Rails; the board
  says so.
- The Codex app-server protocol is experimental and the Claude Code inbox format is undocumented; the
  bridge ignores what it doesn't understand, and the tests pin the payload shapes it relies on.
- Opening a scratch folder in Codex or Claude Code saves a folder-trust entry in their own config; tests
  that use real agents leave those behind.
