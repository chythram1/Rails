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
 browser(s) ──HTTP /api/*──▶ Hono ──▶ ProjectStore (SQLite ~/.rails/rails.db)
     ▲                         │
     │                         ├──▶ adapters/{claude,pi,codex}.listSessions/readTranscript
     │                         │        (reads provider transcript files, read-only)
     │                         └──▶ git.status(project.path)  (git CLI, read-only)
     │
     └────── WS /ws ◀──────── LiveHub ──▶ ClaudeLive (Claude Agent SDK `query()` process)
            subscribe(sessionKey)          emits normalized Message / permission events
            send / approve / interrupt     one process per live session, owned by the server
```

- **Source of truth for history** is the provider transcript. The DB stores only projects and settings.
  When a live session ends, its transcript already exists on disk, so nothing gets copied.
- **Live sessions** are keyed by `provider:sessionId`. A new chat gets a temporary key until the provider
  reports its real session id (the Claude `system/init` event). The server then announces `session.started`
  with the real id.
- **Multi-device:** every WS client subscribed to a session gets the same events. When a client subscribes,
  it gets a replay of the live buffer. Closing a browser never stops an agent. Stopping requires an explicit
  `interrupt` or `stop`.
- **Auth:** one access token. It is generated on first run into `~/.rails/config.json`, or set with the
  `RAILS_TOKEN` env var. The token is exchanged for an httpOnly cookie, and the WS upgrade checks the cookie.
  The server binds `127.0.0.1` by default. Set `RAILS_HOST=0.0.0.0` for LAN or Tailscale access.

## Provider support matrix (v1)

| Provider | Discovery | Transcript view | Live / resume |
| --- | --- | --- | --- |
| claude | ✅ `~/.claude/projects/*/*.jsonl` | ✅ | ✅ via `@anthropic-ai/claude-agent-sdk` |
| pi | ✅ `~/.pi/agent/sessions/*/*.jsonl` | ✅ | ⏳ planned (`pi --mode rpc --session <id>`) |
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
