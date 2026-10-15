# Roadmap and ideas

None of this is fixed. Move items here as they firm up, and record real decisions as ADRs.

Scope: rails supports exactly three coding agents, Claude Code, Codex and pi. The goal is the best
possible chat support for these three, not adding more providers.

## Next
- Provider icons: the sidebar session rows now show the official logos (`ProviderIcon`, with sources in
  `packages/web/src/assets/providers/README.md`). Possible next step: use them in the home cards, the
  session header and the agent picker too. The picker would need a custom dropdown.
- Live adapters for pi (`--mode rpc`) and codex (`app-server`)
- Live-tail transcripts of sessions running outside rails (read-only mirror)
- Git actions: stage/commit, branch, and a worktree per session
- Session search across projects
- Show the session's model in the composer and let the user pick it

## Later
- **Customize:** agent profiles (model, system prompt, tools, permission mode)
- **Automate:** saved prompts on a schedule or trigger (PR opened, Slack mention), with run history
  (see the "Pinned automations" cards in `style.png`)
- **Custom harness:** rails' own agent loop as an additional provider
- **Home agent:** a lean, always-on agent native to rails (likely the harness's first user, possibly as a
  `rails` provider). It manages things across all projects and can work from `~`.
  - Can: read across projects (sessions, transcripts, git status) and message sessions.
  - Cannot: start sessions. Approving other agents' permission requests may come later, not in v1.
  - Always on means it persists and wakes on messages or events. It doesn't poll.
  - Every message it sends is labeled in the UI as coming from the home agent.
  - Open question: messaging a non-live (discovered) session would resume it, which starts a process.
    The suggested default is live sessions only; the alternative is "resume if needed". Not decided yet.
  - Prep: keep server logic in plain service functions so it can be exposed as agent tools later.
- Plugins and MCP server management
- Multi-user accounts, remote runners
