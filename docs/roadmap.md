# Roadmap and ideas

None of this is fixed. Move items here as they firm up, and record real decisions as ADRs.

Scope: exactly three coding agents, Claude Code, Codex and pi (ADR 0002).

## Next
- **Sprockets stage 2:** make them run and reply (ADR 0005). Each Sprocket attaches to one project and acts as a
  coordination layer between that project's sessions. Sprockets replace the earlier "home agent" idea.
- Verify Codex panels on a machine with Codex installed; map new Codex panels to their session id
- "Needs attention" signal for panels (e.g. Claude Code hooks or terminal bell), lost with the chat UI
- Provider logos in the agent picker on Home (needs a custom dropdown)
- Adopt sessions running in the user's own terminal (today only panels started by rails are shared)
- Adding projects from another device: Recent works anywhere, but "Open folder…" opens on the server's screen (ADR 0004)
- Git actions: stage/commit, branch, and a worktree per session
- Session search across projects
- Show the session's model in the composer and let the user pick it

## Later
- **Desktop app:** ship the server and UI as one desktop app. Electron is the likely shell, since it keeps
  the Node server (node-pty, `node:sqlite`, tmux) as it is; the native folder picker (ADR 0004) fits a desktop
  app well. An earlier idea, a Rust port with Tauri, is dropped unless a real need appears. Write an ADR
  when this starts.
- **Customize:** agent profiles (model, system prompt, tools, permission mode)
- **Automate:** saved prompts on a schedule or trigger (PR opened, Slack mention), with run history
  (see the "Pinned automations" cards in `ref/style.png`)
- **Custom harness:** rails' own agent loop as an additional provider
- Plugins and MCP server management
- Multi-user accounts, remote runners
