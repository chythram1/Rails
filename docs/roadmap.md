# Roadmap and ideas

None of this is fixed. Move items here as they firm up, and record real decisions as ADRs.

Scope: exactly three coding agents, Claude Code, Codex and pi (ADR 0002).

## Next
- **Sprockets stage 2, next parts.** ADR 0006 covers replies, model providers, projects and core memory.
  ADR 0007 lets Sprockets see their project's sessions, and ADR 0008 gives them a harness (codemode over
  capabilities: sessions, git, files), and ADR 0009 wakes a project's Coordinator when a session waits
  for the user; ADR 0010 lets it suggest the answer, which the user sends with one tap, and ADR 0011
  gives it standing rules. The workspace's side panel has the project's Sprockets beside its sessions,
  a fast decision model can judge in shadow (ADR 0012), and the Sprocket list is grouped by project. Next: tune the decision model's bars from the shadow log (ADR 0013 lets it add wakes), automatic answers for trusted rules, a project brief, digests.
  Overlap warnings (ADR 0014) and handoffs (ADR 0015) cover coordinating sessions; ADR 0016 makes a project's one
  Sprocket its Coordinator, adds owners and counts edits made by shell commands. Repeat runs go through `scripts/test-run`, and
  the Coordinator's drafts are measured against the run's mistakes with `scripts/coordinator-check`.
  Sprockets replace the earlier "home agent" idea.
- Adopt sessions running in the user's own terminal (today only panels started by Rails are shared)
- Adding projects from another device: Recent works anywhere, but "Open folder…" opens on the server's screen (ADR 0004)
- Git actions: stage/commit, branch, and a worktree per session
- Session search across projects
- Show the session's model in the composer and let the user change it

## Later
- **Desktop app:** ship the server and UI as one desktop app. Electron is the likely shell, since it keeps
  the Node server (node-pty, `node:sqlite`, tmux) as it is; the native folder picker (ADR 0004) fits a desktop
  app well. An earlier idea, a Rust port with Tauri, is dropped unless a real need appears. Write an ADR
  when this starts.
- **Customize, next parts** (ADR 0025): more connectors (each checked first), plugins
  (bundles of skills, servers and prompts), MCP tools in the project chat, Sprockets writing their own skills
- **Automate:** saved prompts on a schedule or trigger, using Customize's servers and skills and its approvals (PR opened, Slack mention), with run history
  (see the "Pinned automations" cards in `ref/style.png`)
- **Custom harness:** Rails' own agent loop as an additional provider
- Plugins and MCP server management
- Multi-user accounts, remote runners
