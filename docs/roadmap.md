# Roadmap and ideas

None of this is fixed. Move items here as they firm up, and record real decisions as ADRs.

Scope: exactly three coding agents, Claude Code, Codex and pi (ADR 0002).

## Next
- Verify Codex panels on a machine with Codex installed; map new Codex panels to their session id
- "Needs attention" signal for panels (e.g. Claude Code hooks or terminal bell), lost with the chat UI
- Provider logos in the home agent picker (needs a custom dropdown)
- Adopt sessions running in the user's own terminal (today only panels started by rails are shared)
- Adding projects from another device: Recent works anywhere, but "Open folder…" opens on the server's screen (ADR 0004)
- Git actions: stage/commit, branch, and a worktree per session
- Session search across projects
- Show the session's model in the composer and let the user pick it

## Later
- **Final form: a single Rust binary that runs as a desktop app.** Near the end, port the server to Rust
  and ship it with the UI as one desktop app (likely a webview shell such as Tauri, so the React UI can
  stay). Things that map over: the REST + WebSocket contract in `packages/shared`, SQLite, tmux, and the
  native folder picker (ADR 0004, which fits a desktop app well). Things that need Rust replacements:
  Hono, `node:sqlite`, node-pty (e.g. `portable-pty`), and the TypeScript discovery adapters. This is a
  goal, not a decision yet; write an ADR when the port starts.
- **Customize:** agent profiles (model, system prompt, tools, permission mode)
- **Automate:** saved prompts on a schedule or trigger (PR opened, Slack mention), with run history
  (see the "Pinned automations" cards in `ref/style.png`)
- **Custom harness:** rails' own agent loop as an additional provider
- **Home agent:** a lean, always-on agent native to rails (likely the harness's first user, possibly as a
  `rails` provider). It manages things across all projects and can work from `~`.
  - Can: read across projects (sessions, transcripts, git status) and message sessions (with panels,
    that likely means typing into a panel's terminal).
  - Cannot: start sessions. Approving other agents' permission requests may come later, not in v1.
  - Always on means it persists and wakes on messages or events. It doesn't poll.
  - Every message it sends is labeled in the UI as coming from the home agent.
  - Open question: messaging a non-live (discovered) session would resume it, which starts a process.
    The suggested default is live sessions only; the alternative is "resume if needed". Not decided yet.
  - Prep: server logic stays in plain service functions (an AGENTS.md invariant) so it can become agent tools.
- Plugins and MCP server management
- Multi-user accounts, remote runners
