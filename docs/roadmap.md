# Roadmap and ideas

None of this is fixed. Move items here as they firm up, and record real decisions as ADRs.

Scope: exactly three coding agents, Claude Code, Codex and pi (ADR 0002).

## Next
- Provider logos in the home cards, session header and agent picker (the sidebar already has them; the
  picker needs a custom dropdown)
- Live adapters for pi (`--mode rpc`) and codex (`app-server`)
- Live-tail transcripts of sessions running outside rails (read-only mirror)
- Git actions: stage/commit, branch, and a worktree per session
- Session search across projects
- Show the session's model in the composer and let the user pick it

## Later
- **Customize:** agent profiles (model, system prompt, tools, permission mode)
- **Automate:** saved prompts on a schedule or trigger (PR opened, Slack mention), with run history
  (see the "Pinned automations" cards in `ref/style.png`)
- **Custom harness:** rails' own agent loop as an additional provider
- **Home agent:** a lean, always-on agent native to rails (likely the harness's first user, possibly as a
  `rails` provider). It manages things across all projects and can work from `~`.
  - Can: read across projects (sessions, transcripts, git status) and message sessions.
  - Cannot: start sessions. Approving other agents' permission requests may come later, not in v1.
  - Always on means it persists and wakes on messages or events. It doesn't poll.
  - Every message it sends is labeled in the UI as coming from the home agent.
  - Open question: messaging a non-live (discovered) session would resume it, which starts a process.
    The suggested default is live sessions only; the alternative is "resume if needed". Not decided yet.
  - Prep: server logic stays in plain service functions (an AGENTS.md invariant) so it can become agent tools.
- Plugins and MCP server management
- Multi-user accounts, remote runners
