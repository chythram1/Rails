# ADR 0001: v1 foundations

Status: accepted (initial scaffold)

These were decided in the initial design interview. Each one can be revisited in a later ADR.

1. **Stack: TypeScript monorepo** with npm workspaces: `shared`, `server` (Node + Hono + ws), and `web`
   (React + Vite). The agent SDKs (Claude Agent SDK, Codex, pi) are Node-native, so adapters run in-process.
   "rails" is only the product name and has nothing to do with Ruby on Rails.
2. **Structured adapters, not terminal embedding.** Each provider is driven through its programmatic mode,
   so the UI can show real messages, tool calls, and permission requests. A PTY fallback may come later.
3. **Discovery is read-only, and resume happens in the app.** rails scans provider transcript stores, shows
   their history, and resumes a session by starting the provider with its resume id. It does not live-mirror
   sessions running in someone else's terminal in v1.
4. **First milestone:** UI shell modeled on `ref/style.png`, projects attached by directory, discovery for
   claude, pi, and codex, transcript viewing, and live chat and resume for **Claude only**.
5. **Single user with access-token auth.** Binds localhost by default. LAN or Tailscale is opt-in.
6. **Shared live view.** The server owns agent processes. Every connected client sees and can drive the
   same session. Disconnecting never kills an agent.
7. **SQLite in `~/.rails`** holds projects and settings. Provider transcripts stay the source of truth
   for messages. rails indexes them and never copies them.
8. **Vocabulary:** Project / Session / Provider (see CONTEXT.md). The UI can say "chat".
9. **Git is read-only in v1:** branch, ahead/behind, changed files, and the diff for each file.
   Commit and worktree-per-session come later.
10. **Tool approvals happen in the UI.** Permission requests show up as cards that any client can answer.
    Each live session has a permission-mode selector.
11. **Project suggestions:** the "Add project" dialog lists directories found in provider stores and also
    accepts a manual path. Nothing is attached automatically.
12. **No project-less sessions in v1.** Every session belongs to a project.
