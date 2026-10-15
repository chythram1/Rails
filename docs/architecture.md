# Architecture

rails is a self-hosted web app that works as an **agent multiplexer**. You attach local project
directories, and rails discovers the sessions that existing coding agents (Claude Code, Codex, pi)
already have on disk for them. You can then read those sessions or resume and chat with them live
from any device.

Terms are defined in [CONTEXT.md](./CONTEXT.md). Decisions and their reasons are in [adr/](./adr).

## Layout

```
packages/
  shared/   @rails/shared  TypeScript types for the wire protocol + domain (no runtime deps)
  server/   @rails/server  Node + Hono HTTP API, WebSocket hub, SQLite, provider adapters
  web/      @rails/web     React + Vite SPA (the UI). Served by Vite in dev, by the server in prod.
```

## Runtime picture

```
 browser(s) ──HTTP /api/*──▶ Hono (index.ts) ──▶ db.ts `projects` (SQLite ~/.rails/rails.db)
     ▲                         │
     │                         ├──▶ providers/{claude,pi,codex}.scan() / readTranscript()
     │                         │        (reads provider transcript files, read-only)
     │                         └──▶ git.ts gitStatus() / gitDiff()  (git CLI, read-only)
     │
     └────── WS /ws ◀──────── LiveHub (live/hub.ts) ──▶ ClaudeLive (live/claude.ts)
            subscribe / send / permission              one Claude Agent SDK `query()` per live session,
            interrupt / stop / setMode                 emits normalized Message + permission events
```

- **History** comes from the provider transcript, which is the source of truth. The DB stores only
  projects. A live session's transcript is written by the provider itself, so rails never copies messages.
- **Live session lifecycle:**
  - *New chat* (`start`): the server picks the session UUID, starts the SDK with `sessionId: <uuid>`, and
    immediately replies `session.started` with the final key `claude:<uuid>`. There is no temporary key.
  - *Resume* (`send` to a key that isn't live): the server finds the transcript, then starts the SDK with
    `resume: <id>` in the transcript's recorded cwd.
  - Status moves `starting → running → idle` per turn. `interrupt` cancels the current turn but keeps
    the process. `stop` ends the process, after which the session drops out of the live list.
  - Live state, the replay buffer and pending permission requests live only in memory. A server restart
    stops every live session, but the transcripts stay on disk and can be resumed.
- **Multi-device:** every WS client subscribed to a session gets the same events. A client that subscribes
  late gets a `snapshot` with the live buffer and pending permission requests. The client merges
  transcript history with live messages by id. Closing a browser never stops an agent.
- **Permissions:** `canUseTool` turns each tool request into a `permission.request` event. The first
  client to answer wins, and every client gets `permission.resolved`.
- **Auth:** one access token, generated on first run into `~/.rails/config.json` or set with `RAILS_TOKEN`.
  `POST /api/auth/login` exchanges it for an httpOnly cookie, and both `/api/*` and the WebSocket
  upgrade check that cookie. The web app also accepts `?token=` once, then removes it from the URL.
  The server binds `127.0.0.1` by default. Set `RAILS_HOST=0.0.0.0` for LAN or Tailscale access.
- **Discovery** runs on request (sidebar refresh, about every 20s while the app is open). It scans every
  provider store and keeps sessions whose cwd is the project directory or inside it. Per-file results
  are cached by mtime and size.

## Provider support matrix (v1)

| Provider | Discovery | Transcript view | Live / resume |
| --- | --- | --- | --- |
| claude | ✅ `~/.claude/projects/*/*.jsonl` | ✅ | ✅ via `@anthropic-ai/claude-agent-sdk` |
| pi | ✅ `~/.pi/agent/sessions/*/*.jsonl` | ✅ | ⏳ planned (`pi --mode rpc`, with `--session <id>` to resume) |
| codex | ✅ `~/.codex/sessions/**/rollout-*.jsonl` (format from docs; untested locally) | ✅ | ⏳ planned (`codex app-server`) |

Transcript format notes are in [providers.md](./providers.md).

## Config / env

| Var | Default | Meaning |
| --- | --- | --- |
| `RAILS_HOME` | `~/.rails` | DB + config dir |
| `RAILS_HOST` | `127.0.0.1` | bind address |
| `RAILS_PORT` | `4317` | server port (Vite dev runs on 5173 and proxies to it) |
| `RAILS_TOKEN` | generated | access token override |
| `CLAUDE_HOME` / `PI_HOME` / `CODEX_HOME` | `~/.claude`, `~/.pi/agent`, `~/.codex` | provider store roots |
