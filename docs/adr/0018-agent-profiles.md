# ADR 0018: Agent profiles and saved prompts

Status: accepted.

People run the same agent for different kinds of work: research, frontend, backend. Each wants its own model,
effort, instructions, permission mode, tools, MCP servers and skills, and often starts it with the same few
prompts. Customize was a placeholder for this. An agent profile is a saved set of those choices that a panel
starts with; a saved prompt is a message the user starts agents with.

Decisions:
- **Flags only.** A profile becomes command-line flags when Rails starts the agent, after the bridge's own
  (ADR 0007), each value its own argv entry, so nothing is shell-quoted. Rails never writes the user's or the
  project's agent settings. For Claude Code: `--model`, `--effort`, `--permission-mode`, `--append-system-prompt`, `--allowedTools` / `--disallowedTools`, `--mcp-config <json>`
  (with `--strict-mcp-config` for "Only these servers") and `--plugin-dir` for skills. The bridge keeps `--settings`
  to itself, so nothing is merged.
- **Skills come from a plugin folder per panel.** At start, Rails writes `RAILS_HOME/panel-plugins/<panelId>/`: a
  `.claude-plugin/plugin.json` and `skills/<name>` links to each chosen skill's folder. Claude Code lists them as
  `rails:<name>`. The folder is deleted with the panel. A per-panel folder means editing a profile never changes
  what a running panel loaded.
- **Skills are found, not managed.** The Skill library (`RAILS_HOME/skills`) is Rails' own; skills are also found,
  read-only, in `~/.claude/skills`, `~/.agents/skills` and the project's `.claude/skills` and `.agents/skills`.
  Discovery reads only each `SKILL.md`'s front matter. A profile refers to a skill by source and name; a project's
  skill only resolves in that project, and a skill that can't be found is skipped at start.
- **One default per agent.** A panel started without a profile picked uses the agent's default, if it has one.
  The `+` menu and Home show the default's name next to the agent.
- **Resume reapplies the profile.** Rails remembers which profile started a session (`session_profiles`) and
  starts it with that profile's current flags when it's opened again; a session that started without one (or
  whose profile was deleted) resumes with the agent's default. Claude Code keeps a session's original
  system prompt on `--resume` (checked with Claude Code in October 2026), so edited instructions reach only new
  sessions; the model, permission mode, tools, MCP servers and skills change on resume.
- **Profiles add; they don't isolate.** The user's and the project's own settings, skills and CLAUDE.md still
  load. The UI doesn't promise otherwise.
- **Claude Code first.** The profile has a `provider`; only `claude` can be chosen until Codex (`--profile`,
  but any `-c` flag takes its panel off the app-server daemon, see `providers.md`) and pi are mapped and tested.
- **Called "agent profile" everywhere.** "Profile" already means the user's name and avatar.
- **Panels keep a copy.** A panel stores the name, model, effort and permission mode of the profile it started
  with (`panels.profile`), shown in its tab's tooltip and on the board (`project_board`, `list_sessions`), so a
  Coordinator knows a session runs in plan mode or on a small model. Editing or deleting a profile changes only
  later panels. A profile's editor lists where it's in use (its running panels, each a link) and has **Start**,
  which opens a panel with it in a project the user picks.
- **Saved prompts** are a name and a text (`saved_prompts`). Home's composer and Sprocket chats list them and
  fill one in, where the user can still edit it; a prompt's **Use on Home** (`#/new/<promptId>`) does the same.
  Every Sprocket can read them (`saved_prompts`, `harness/prompts.ts`), so "send my Review prompt to the API
  session" becomes a suggested message; Sprockets can't change profiles or prompts.
- **Stored on the server**, broadcast as `customize.changed`, so every device sees the same ones.

Considered: writing a `.claude/settings.local.json` into the project (simple, but it writes files Rails doesn't
own, and every session in the project would get it); one plugin folder per profile (fewer files, but editing a
profile would change a running panel's skills under it); copying skills instead of linking them (survives the
source being deleted, but goes stale when it's edited).
