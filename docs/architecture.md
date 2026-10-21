# Architecture

Rails is a self-hosted web app that works as an **agent multiplexer**. You attach local project
directories, and Rails discovers the sessions that existing coding agents (Claude Code, Codex, pi)
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
 browser(s) ──HTTP /api/*──▶ Hono (index.ts) ──▶ services: projects.ts, panels.ts, git.ts, customize.ts
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

- **Titles:** a session shows the name the user gave it in Rails (ADR 0019, `names.ts`), else the agent's own title
  (Claude Code's `custom-title` or `ai-title`, pi's `/name`, Codex's thread name in `session_index.jsonl`), else its
  first prompt. `sessionTitle` in `titles.ts` is the one place that decides.
- **History** lives in provider transcripts. Rails reads them for discovery (titles, dates, the sidebar)
  and, when a Sprocket asks, the end of one transcript (`session_conversation`, at most its last 1 MB). The
  agents write their own transcripts while they run in panels.
- **Panels:** `POST /api/projects/:id/panels` creates a DB row and a detached tmux session running the
  agent's CLI in the project (or the session's recorded cwd). Claude and pi get their session id up
  front (`--session-id`), so the panel knows its session immediately. New Codex panels don't know their
  session id. Opening a session that already has a running panel returns that panel.
  `DELETE /api/panels/:id` kills the tmux session.
  An agent profile adds its flags to the command line (see **Customize** below).
- **Terminals:** each browser terminal sends `term.attach` with its size and a page-unique `attachId`; the server spawns
  `tmux attach` in a PTY for it and streams bytes both ways. Killing that PTY only detaches. While a
  browser terminal is being resized it refits (and reports `term.resize`) at most every 100ms, plus once at
  the end, so dragging a divider doesn't make the agent redraw on every frame. tmux
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
- **Busy:** while any browser is connected, `activity.ts` reads each panel's last-output time from tmux
  (`window_activity`, whole seconds, kept even with no client attached) once a second. A panel turns busy
  after printing in two polls in a row (idle agents print the odd one-off update) and idle after 2s
  without output. Changes are broadcast as `panels.busy`, and the sidebar shows those sessions' dots
  yellow. Typing into an agent also counts as output, and an agent waiting on a permission prompt is idle.
- **Bridge** (ADR 0007, `bridge/`): agents in Rails panels report what they do. `start()` in `panels.ts`
  adds the wiring after the program name (Claude Code `--settings` hooks, pi `--extension bridge/pi/rails.ts`)
  and the panel's bridge token to its tmux environment (`RAILS_BRIDGE`, `RAILS_PANEL_TOKEN`). Reports arrive
  at `POST /bridge/<panelId>/<agent>/<event>` (loopback, token checked) and become `session_events`. Codex
  panels report through Codex's app-server daemon instead (`bridge/codex.ts`, a client only while Codex
  panels are open), which also gives new Codex panels their session id. Events fold into board cards
  (`bridge/board.ts`); panels waiting for the user or with a failed turn are broadcast as
  `panels.attention` (red dots). Files two live sessions both changed in the last 30 minutes are broadcast as
  `panels.overlaps` (amber marks; `overlaps.ts`, ADR 0014). Attached Sprockets read the board through their capabilities (`harness/project.ts`).
  Recorded events also go to the watches (`watches.ts`, ADR 0009): when a session asks the user something (a
  dialog, or a turn that ends with a question) and nobody answers within 20 s, Rails puts an event in the
  project's Coordinator's chat and starts a run. The Coordinator can suggest a reply (`suggest_reply`,
  `suggestions.ts`, ADR 0010), shown under its message; when the user sends it, `bridge/deliver.ts` puts it into
  the session: Claude Code's message socket, the pi extension's long poll (`GET /bridge/<panelId>/pi/inbox`, confirmed with `POST …/pi/delivered`) or
  Codex's `thread/queue/add`. Suggestions expire as soon as their session moves on. A handoff (ADR 0015, `handoffs.ts`, planned by the Coordinator when the user asks) wakes it when its session ends a turn without a question, to draft the message for the other session; handoffs expire after 24 hours and are cancelled when either session ends. Owners (ADR 0016, `owners.ts`), recorded by the Coordinator with `set_owner`, route its requests; an edit to files another session owns wakes it like an overlap. Shell commands' edits count too (`shellEdits.ts`): Rails compares `git status` and file times at a command's start and end. Each run's usage goes in `sprocket_usage`. An overlap also wakes the Coordinator, for the session that changed the files second (batched over 15 s, once per pair and file per 30 minutes); it judges whether they clash and may draft a heads-up with `suggest_message`. A Coordinator's standing rules (ADR 0011) are in its prompt, numbered; a suggestion records the rule it followed. If the user picked a decision model, `decisions.ts` (ADR 0012) asks it about every turn end and unknown dialog in projects with a Coordinator, through pi-ai's `classify()`, and logs its answers next to Rails' own (`decisions` table, `GET /api/decisions`, `decisions.changed`). It may also wake the Coordinator (ADR 0013, `wakeFromModel` in `watches.ts`) for a question the rules missed, unless the session moved on meanwhile; `RAILS_DECISIONS=shadow` keeps it to judging.
- **Agent profiles** (ADR 0020, `agentProfiles.ts`): saved ways to start Claude Code, made in Customize and
  stored in SQLite (`agent_profiles`). `openPanel` adds the profile's flags after the bridge's (the one in
  `agentProfileId`, else the session's own, else the agent's default; `launchProfile()`): `--model`, `--effort`, `--permission-mode`, `--append-system-prompt`, `--allowedTools` / `--disallowedTools`,
  `--mcp-config <file>` (a 0600 `mcp.json` in the panel's folder; `--strict-mcp-config` for "Only these servers") and `--plugin-dir` for skills. The
  plugin folder is made per panel (`RAILS_HOME/panel-plugins/<panelId>`: a `plugin.json` and links to each
  skill's folder, `rails:<name>` in Claude Code) and deleted with the panel. `session_profiles` remembers which
  profile started a session, so resuming it reapplies that profile. A panel keeps a copy of its profile's name,
  model, effort and permission mode (`panels.profile`), which the board shows Sprockets. Skills (`skills.ts`) are found in the skill
  library (`RAILS_HOME/skills`), `~/.claude/skills`, `~/.agents/skills` and each project's `.claude/skills` and
  `.agents/skills`, reading only each `SKILL.md`'s front matter (cached by mtime and size). "Import from folder…"
  copies a skill into the library through the native folder picker. Saved prompts (`savedPrompts.ts`,
  `saved_prompts`) fill Home's composer and Sprocket chats, and Sprockets read them with `saved_prompts`. Changes
  to either are broadcast as `customize.changed`. Routes: `GET/POST /api/agent-profiles`,
  `PUT/DELETE /api/agent-profiles/:id`, `POST /api/agent-profiles/:id/duplicate`, `GET /api/agent-profiles/:id/panels` (where it's in use),
  `GET/POST /api/prompts`, `PUT/DELETE /api/prompts/:id`, `GET /api/skills`, `POST /api/skills/import`. The web
  pages are `#/customize`, `#/customize/profiles/<id>` and `#/customize/prompts/<id>`; a profile's Start opens a
  panel with it, and a prompt's "Use on Home" goes to `#/new/<promptId>`, which fills Home's composer.
- **Persistence:** panels survive browser disconnects and server restarts (`tsx watch` included).
  On a reboot the tmux server is gone; the next workspace read drops panels whose tmux session no
  longer exists. Their transcripts remain, so sessions can be resumed from the sidebar.
- **Layout:** the web app saves dockview's `toJSON()` per project (`PUT /api/projects/:id/layout`). The
  server stores it opaquely. The server's panel list is the source of truth: on load the client
  restores the layout, then adds panels missing from it and removes ones that were closed.
  `panels.changed` broadcasts keep other devices' panel lists current. Beside the panes, a side panel
  (`SidePanel.tsx`) shows the project's Sprocket's chat (one per project, ADR 0016), its files (a tree with each file's git state, `tree.ts`) or Git; panels with a suggested reply waiting
  (`Sprocket.pending`) get a mark on their tab.
- **Sprockets** (ADR 0005, 0006): `sprockets.ts` stores Sprockets, their chats and settings (project, model,
  description, whether it's its project's Coordinator; core memory stays internal) in SQLite and broadcasts `sprockets.changed`. A user message (or, for a Coordinator, an event) starts a run (`runs.ts`): a
  pi-agent-core loop on the Sprocket's model, streamed to browsers as `sprockets.typing`, capped at 12 model
  calls, 30 runs per Sprocket per hour and 2 runs at once. Its one tool is codemode (ADR 0008,
  `harness/codemode.ts`): scripts run in pi's QuickJS sandbox and call the Sprocket's capabilities (`harness/`:
  memory; and for attached Sprockets the board, sessions, git and read-only files, `files.ts`). Each call's step goes
  to browsers as `sprockets.activity`, and the run's summary is saved on the reply (the run log). `models.ts` holds the model providers (pi-ai),
  the default model and sign-ins; credentials are in `RAILS_HOME/credentials.json`. `signin.ts` runs the
  sign-ins (ChatGPT, OpenRouter) itself and stores pi-ai's credential shape; callbacks land on the server's
  `127.0.0.1` (OpenAI: port 1455). The web renders each Sprocket as an SVG character from data
  (`components/sprockets/`); idle motion is CSS, eyes follow the pointer only in the creator, and the
  loops stop when the OS asks for reduced motion.
- **Auth:** one access token, generated on first run into `~/.rails/config.json` or set with `RAILS_TOKEN`.
  `POST /api/auth/login` exchanges it for an httpOnly cookie, and both `/api/*` and the WebSocket
  upgrade check that cookie. The web app also accepts `?token=` once, then removes it from the URL.
  Cookies are shared across every port of a host, so the WebSocket upgrade and non-GET `/api` requests
  also require `Origin` to match `Host` (when an Origin is sent). That's why the Vite dev proxy keeps the
  browser's `Host` (`changeOrigin: false`).
  Settings → Account signs a browser out (`POST /api/auth/logout` clears its cookie) or signs out every
  device (`POST /api/account/sign-out-everywhere`, `account.ts`): a new token goes into `config.json`, the
  asking browser gets a new cookie and a sign-in link to share, and every WebSocket is closed so the rest
  reconnect, fail and show the sign-in screen (any 401 does that in the web app). A token set with
  `RAILS_TOKEN` can't be replaced this way.
  The profile above it (`profile.ts`) is the name and avatar at the foot of the sidebar, stored with the
  app settings in SQLite. `PUT /api/profile` changes it; each browser gets it as `profile.changed` on
  connect and on every change. Until it's set, the name is the computer's (`scutil --get ComputerName` on
  macOS, else the hostname).
  The server binds `127.0.0.1` by default. Panels are full shell access, so set `RAILS_HOST=0.0.0.0`
  only on networks you trust (LAN, Tailscale).
- **Environment:** tmux and everything in it get the server's environment minus `RAILS_*` (the token),
  `npm_*`, `PI_*`, `CLAUDE_CODE_*`, `CLAUDECODE`, `NODE_ENV` and `INIT_CWD`.
- **Adding projects** (ADR 0004): the Add project menu (`FolderMenu`) lists `GET /api/recent-folders`
  (discovered session folders that still exist and aren't projects yet, newest first) and filters them by
  name on the client, showing at most 8. "Open folder…" calls `POST /api/projects/pick`, which runs the OS folder picker on the server
  (`picker.ts`: osascript on macOS, zenity then kdialog on Linux, PowerShell on Windows) and waits for
  the user. Cancel returns `{project: null}`; a folder that's already a project returns that project.
  The dialog shows on the server's screen, so it's meant for using Rails on the host machine.
- **Discovery** runs on request (sidebar refresh, about every 20s while the app is open, and after
  panel changes). It scans every provider store and keeps sessions whose cwd is the project directory
  or inside it. Per-file results are cached by mtime and size.

## Provider support matrix

| Provider | Discovery | Panels (new / resume) | Agent profiles (ADR 0020) |
| --- | --- | --- | --- |
| claude | ✅ `~/.claude/projects/*/*.jsonl` | ✅ `claude --session-id <uuid> [-- prompt]` / `claude --resume <id>` | ✅ model, effort, permission mode, instructions, tools, MCP servers, skills |
| pi | ✅ `~/.pi/agent/sessions/*/*.jsonl` | ✅ `pi --session-id <uuid> [-- prompt]` / `pi --session <id>` | — |
| codex | ✅ `~/.codex/sessions/**/rollout-*.jsonl`, names from `~/.codex/session_index.jsonl` (checked with Codex 0.163) | ✅ `codex [-- prompt]` / `codex resume <id>`; a new panel learns its session id from Codex's daemon (ADR 0007) | — (any `-c` flag takes a panel off the daemon) |

Every provider panel reports to the bridge (ADR 0007): Claude Code through hooks, pi through the Rails
extension, Codex through its app-server daemon. Edits count for overlaps (ADR 0014) once they worked: Claude
Code's PostToolUse, pi's tool end without an error, Codex's completed file changes (checked live with all
three). Files changed by shell commands count too (ADR 0016).

Agent tools (ADR 0018): Claude Code and pi panels get Rails' MCP server at `/bridge/<panel>/mcp`, behind the
panel's token (`agentTools.ts`): Claude Code from `--mcp-config`, pi from the Rails extension. `neighbours` shows an
agent the other sessions in its project; `message` drafts a message for one of them, which waits in the
Coordinator's chat until the user sends it (no model runs); `wait_for` waits, up to 100 seconds a call, until
another session ends its turn, stops, fails or needs its user. Codex panels get none (it would need the user's config
or a `-c` flag), but they receive messages.

A provider is only offered when its CLI is on the server's `PATH` (`ProviderInfo.installed`).
Transcript format notes are in [providers.md](./providers.md).

## Requirements

- Node 24+ (uses `node:sqlite`), tmux 3.2+ on the server host, and the agents' CLIs on `PATH`. The database
  (`RAILS_HOME/rails.db`) uses write-ahead logging with a 2 s lock wait, so reading it from another process
  (`sqlite3`, a backup) never blocks the server's writes.
  `make system-deps` checks the tmux version and installs tmux with Homebrew, apt or dnf when it's missing;
  `make dev` / `start` / `install` run it first. Without tmux the server logs a warning at startup and the
  panel endpoints answer 503 with that hint. It never treats a missing tmux as "no panels".
- Optional: `nix develop` (`flake.nix` / `flake.lock`) provides pinned Node 24, tmux and the Linux build
  tools instead of `make system-deps`. npm still installs the JS dependencies from `package-lock.json`,
  and the agent CLIs come from the user's `PATH`, never from Nix (they self-update and hold logins).
- node-pty ships prebuilt binaries only for macOS and Windows. On Linux it compiles during `npm install`
  (python3, make, a C++ compiler).
- `npm install` runs a root `postinstall` that marks node-pty's `spawn-helper` executable
  (without it, spawning fails with `posix_spawnp failed`).
- A desktop session on the server for the Add project folder picker. On Linux that means zenity or kdialog
  and `DISPLAY` / `WAYLAND_DISPLAY`.

## Config / env

| Var | Default | Meaning |
| --- | --- | --- |
| `RAILS_HOME` | `~/.rails` | DB, config, `tmux.sock`, `tmux.conf`, the skill library (`skills/`) and per-panel plugin folders (`panel-plugins/`) |
| `RAILS_HOST` | `127.0.0.1` | bind address |
| `RAILS_PORT` | `4317` | server port (Vite dev runs on 5173 and proxies to it) |
| `RAILS_TOKEN` | generated | access token override |
| `RAILS_DECISIONS` | — | `shadow`: the decision model only judges and logs, never wakes the Coordinator (for evaluating a model, ADR 0013) |
| `CLAUDE_HOME` / `PI_HOME` / `CODEX_HOME` | `~/.claude`, `~/.pi/agent`, `~/.codex` | provider store roots |
| `AGENTS_HOME` | `~/.agents` | where the user's agent-neutral skills live (`skills/`), read-only |

Attach to a panel from a normal terminal: `tmux -S ~/.rails/tmux.sock ls`, then
`tmux -S ~/.rails/tmux.sock attach -t p-<panelId>`.
