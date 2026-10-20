# ADR 0020: Customize holds agent profiles and saved prompts

Status: accepted (first part of Customize; tools come later).

Customize was a placeholder. AGENTS.md reserves it for agent profiles, prompts and tools, and keeps app settings
in the Settings modal. Every agent starts in a panel with the same command line, so the user can't say "start
Claude Code on Sonnet in plan mode" without typing `/model` and Shift+Tab in each new panel, and the prompts
they start with often have to be typed again each time.

Decisions:
- **Agent profiles are launch flags.** A profile is a name plus the options of one agent: for Claude Code
  `--model`, `--effort`, `--permission-mode`, `--append-system-prompt`, `--allowed-tools` and
  `--disallowed-tools` (checked with 2.1.303). `profileFlags()` in `panels.ts` inserts them after the bridge's
  flags (ADR 0007), each value its own argv entry, so nothing is shell-quoted. Empty options keep the agent's
  own setting. Rails still never writes an agent's settings files, skills or config.
- **Claude Code first.** pi and Codex aren't installed where this was built, and Codex leaves its app-server
  daemon on any `-c`, `--enable`, `--disable` or `--search` flag, so their flags can't be guessed. Profiles for
  them come when their flags are checked on a real install (`PROFILE_AGENTS` in `packages/shared`).
- **One default per agent.** A panel started without a profile picked uses the agent's default, if any, and so
  does a session opened from the sidebar (`--resume` takes the same flags). The `+` menu starts an agent with its
  default and lists its other profiles under it; Home's composer has a Profile picker.
- **Profiles are checked on the server** (`customize.ts`): known values only, a model name that can't read as a
  flag, tool patterns that don't start with `-` and hold no control characters, bounded lengths, unique names
  per agent. Stored options that no longer pass are dropped when read, so a bad row never breaks a launch.
  "Bypass permissions" is allowed (panels are already full shell access, ADR 0003), with a warning under it.
- **Saved prompts** are a name and a text. Home's composer lists them and fills one in, where the user can still
  edit it, then picks the agent and profile as usual.
- **Stored on the server** (`agent_profiles`, with the options as JSON; `saved_prompts`), broadcast as
  `customize.changed`, so every device sees the same ones.
- **The page** reuses the Sprockets page's list beside a detail view, and Settings' rows for the editor.

*Amended (Sprockets):* a panel keeps a snapshot of the profile it started with (name, model, effort, permission
mode; `panels.profile`), shown in its tab's tooltip and on the board, so a Coordinator knows a session runs in plan
mode or on a small model (`project_board`, `list_sessions`). Every Sprocket can read the saved prompts
(`saved_prompts`, `harness/prompts.ts`), so "send my Review prompt to the API session" becomes a suggested
message, and Sprocket chats have the same saved-prompts button as Home. Sprockets can't change profiles or
prompts. Still to come: a Coordinator suggesting a new session with a profile and prompt, which the user starts
with one tap (its own ADR).

*Amended (starting from Customize):* a profile's editor lists where it's in use (the running panels that started
with it, `GET /api/profiles/:id/panels`, each a link to the panel) and has **Start**, which opens a panel with it
in a project the user picks. A saved prompt has **Use on Home** (`#/new/<promptId>`), which fills Home's composer
so the user still picks the project, agent and profile.

Consequences:
- A panel keeps the flags it started with; editing or deleting a profile changes only later panels.
- Not yet: profiles for pi and Codex, and a Tools section (MCP servers, skills), which would also have to be
  passed as flags (`--mcp-config`, `--plugin-dir`) rather than written into the agents' config.
