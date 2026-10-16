# Architecture

rails is a self-hosted web app that works as an **agent multiplexer**. You attach local project
directories, and rails discovers the sessions that existing coding agents (Claude Code, Codex, pi)
already have on disk for them. Each project has a workspace of terminal panels running the agents'
own TUIs, which you can split, resize and rearrange, and use from any device (ADR 0003).

Terms are defined in [CONTEXT.md](./CONTEXT.md). Decisions and their reasons are in [adr/](./adr).

## Layout

```
packages/
  shared/   @rails/shared  TypeScript types for the wire protocol + domain (no runtime deps)
  server/   @rails/server  Node + Hono HTTP API, terminal WebSocket hub, SQLite, tmux, discovery
  web/      @rails/web     React + Vite SPA: dockview layout + xterm.js terminals. Vite in dev, the server in prod.
```

## Runtime picture

```
 browser(s) ──HTTP /api/*──▶ Hono (index.ts) ──▶ services: projects.ts, panels.ts, git.ts
     ▲                                             │          │
     │                                             │          ├─▶ db.ts: projects, panels, layouts (SQLite)
     │                                             │          └─▶ tmux.ts: new-session / kill / running panels
     │                                             └─▶ providers/*: scan transcripts (read-only)
     │
     └──── WS /ws ◀── TerminalHub (terminals.ts) ──▶ node-pty: `tmux attach -t p-<panelId>`
           term.attach / input / resize / detach      one tmux client per (browser, panel)

 tmux server on $RAILS_HOME/tmux.sock
   session p-<panelId> ──▶ `claude --resume <id>` | `pi --session <id>` | `codex resume <id>` | $SHELL -l
```

- **History** lives in provider transcripts. rails reads them only for discovery (titles, dates, the
  sidebar). The agents write their own transcripts while they run in panels.
- **Panels:** `POST /api/projects/:id/panels` creates a DB row and a detached tmux session running the
  agent's CLI in the project (or the session's recorded cwd). Claude and pi get their session id up
  front (`--session-id`), so the panel knows its session immediately. New Codex panels don't know their
  session id. Opening a session that already has a running panel returns that panel.
  `DELETE /api/panels/:id` kills the tmux session.
- **Terminals:** each browser terminal sends `term.attach` with its size and a page-unique `attachId`; the server spawns
  `tmux attach` in a PTY for it and streams bytes both ways. Killing that PTY only detaches. tmux
  `window-size latest` sizes a panel shown on several devices to the one used last. Typing counts, and
  so does focusing a terminal: `TerminalView` sends a focus-in event (`ESC [ I`) when its terminal gains
  focus, which tmux treats as activity and swallows (tmux only forwards it to programs that asked for
  focus events).
  Output is tagged with its `attachId`, and a terminal drops output from an earlier attach. Otherwise a
  quick re-attach (remount, React StrictMode, reconnect) answers the old tmux client's terminal queries
  too, and the new client types the extra reply (`?1;2c>0;276;0c`) into the program.
- **Exits:** a panel closes itself when its process exits (`exit`, `/exit`, a crash). tmux has
  `remain-on-exit off`, so the session ends with the process; the attached browsers' tmux clients then
  exit, and `panelEnded` deletes the panel and broadcasts `panels.changed` so every device drops the tab.
  Panels that ended while no browser was attached are dropped on the next workspace read.
- **Persistence:** panels survive browser disconnects and server restarts (`tsx watch` included).
  On a reboot the tmux server is gone; the next workspace read drops panels whose tmux session no
  longer exists. Their transcripts remain, so sessions can be resumed from the sidebar.
- **Layout:** the web app saves dockview's `toJSON()` per project (`PUT /api/projects/:id/layout`). The
  server stores it opaquely. The server's panel list is the source of truth: on load the client
  restores the layout, then adds panels missing from it and removes ones that were closed.
  `panels.changed` broadcasts keep other devices' panel lists current.
- **Auth:** one access token, generated on first run into `~/.rails/config.json` or set with `RAILS_TOKEN`.
  `POST /api/auth/login` exchanges it for an httpOnly cookie, and both `/api/*` and the WebSocket
  upgrade check that cookie. The web app also accepts `?token=` once, then removes it from the URL.
  The server binds `127.0.0.1` by default. Panels are full shell access, so set `RAILS_HOST=0.0.0.0`
  only on networks you trust (LAN, Tailscale).
- **Environment:** tmux and everything in it get the server's environment minus `RAILS_*` (the token),
  `npm_*`, `PI_*`, `CLAUDE_CODE_*`, `CLAUDECODE`, `NODE_ENV` and `INIT_CWD`.
- **Adding projects** (ADR 0004): `POST /api/projects/pick` runs the OS folder picker on the server
  (`picker.ts`: osascript on macOS, zenity then kdialog on Linux, PowerShell on Windows) and waits for
  the user. Cancel returns `{project: null}`; a folder that's already a project returns that project.
  The dialog shows on the server's screen, so it's meant for using rails on the host machine.
- **Discovery** runs on request (sidebar refresh, about every 20s while the app is open, and after
  panel changes). It scans every provider store and keeps sessions whose cwd is the project directory
  or inside it. Per-file results are cached by mtime and size.

## Provider support matrix

| Provider | Discovery | Panels (new / resume) |
| --- | --- | --- |
| claude | ✅ `~/.claude/projects/*/*.jsonl` | ✅ `claude --session-id <uuid> [-- prompt]` / `claude --resume <id>` |
| pi | ✅ `~/.pi/agent/sessions/*/*.jsonl` | ✅ `pi --session-id <uuid> [-- prompt]` / `pi --session <id>` |
| codex | ✅ `~/.codex/sessions/**/rollout-*.jsonl` (format from docs; untested locally) | ⚠️ `codex [-- prompt]` / `codex resume <id>` (untested: Codex isn't installed here) |

A provider is only offered when its CLI is on the server's `PATH` (`ProviderInfo.installed`).
Transcript format notes are in [providers.md](./providers.md).

## Requirements

- Node 24+ (uses `node:sqlite`), tmux 3.2+ on the server host, and the agents' CLIs on `PATH`.
  `make system-deps` checks the tmux version and installs tmux with Homebrew, apt or dnf when it's missing;
  `make dev` / `start` / `install` run it first. Without tmux the server logs a warning at startup and the
  panel endpoints answer 503 with that hint. It never treats a missing tmux as "no panels".
- node-pty ships prebuilt binaries only for macOS and Windows. On Linux it compiles during `npm install`
  (python3, make, a C++ compiler).
- `npm install` runs a root `postinstall` that marks node-pty's `spawn-helper` executable
  (without it, spawning fails with `posix_spawnp failed`).
- A desktop session on the server for the Add project folder picker. On Linux that means zenity or kdialog
  and `DISPLAY` / `WAYLAND_DISPLAY`.

## Config / env

| Var | Default | Meaning |
| --- | --- | --- |
| `RAILS_HOME` | `~/.rails` | DB, config, `tmux.sock` and `tmux.conf` |
| `RAILS_HOST` | `127.0.0.1` | bind address |
| `RAILS_PORT` | `4317` | server port (Vite dev runs on 5173 and proxies to it) |
| `RAILS_TOKEN` | generated | access token override |
| `CLAUDE_HOME` / `PI_HOME` / `CODEX_HOME` | `~/.claude`, `~/.pi/agent`, `~/.codex` | provider store roots |

Attach to a panel from a normal terminal: `tmux -S ~/.rails/tmux.sock ls`, then
`tmux -S ~/.rails/tmux.sock attach -t p-<panelId>`.
