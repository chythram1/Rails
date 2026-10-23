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
  `panels.overlaps` (amber marks; `overlaps.ts`, ADR 0014). A turn end whose reply names a problem in another
  session's files, without telling it, wakes the Coordinator as a finding (`findings.ts`, ADR 0029). Attached Sprockets read the board through their capabilities (`harness/project.ts`).
  Recorded events also go to the watches (`watches.ts`, ADR 0009): when a session asks the user something (a
  dialog, or a turn that ends with a question) or waits for their permission (ADR 0026: the Coordinator only says
  what it's for and whether its rules allow it) and nobody answers within 20 s, Rails puts an event in the
  project's chat (ADR 0021) and starts the Coordinator's run there. The Coordinator can suggest a reply (`suggest_reply`,
  `suggestions.ts`, ADR 0010), shown under its message; when the user sends it, `bridge/deliver.ts` puts it into
  the session: Claude Code's message socket, the pi extension's long poll (`GET /bridge/<panelId>/pi/inbox`, confirmed with `POST …/pi/delivered`) or
  Codex's `thread/queue/add`. Suggestions expire as soon as their session moves on. A handoff (ADR 0015, `handoffs.ts`, planned by the Coordinator when the user asks) wakes it when its session ends a turn without a question, to draft the message for the other session; handoffs expire after 24 hours and are cancelled when either session ends. Owners (ADR 0016, `owners.ts`), recorded by the Coordinator with `set_owner`, route its requests; an edit to files another session owns wakes it like an overlap. Shell commands' edits count too (`shellEdits.ts`): Rails compares `git status` and file times at a command's start and end. Each run's usage goes in `sprocket_usage`. An overlap also wakes the Coordinator, for the session that changed the files second (batched over 15 s, once per pair and file per 30 minutes); it judges whether they clash and may draft a heads-up with `suggest_message`. A Coordinator's standing rules (ADR 0011) are in its prompt, numbered; a suggestion records the rule it followed. If the user picked a decision model, `decisions.ts` (ADR 0012) asks it about every turn end and unknown dialog in projects with a Coordinator, through pi-ai's `classify()`, and logs its answers next to Rails' own (`decisions` table, `GET /api/decisions`, `decisions.changed`). It may also wake the Coordinator (ADR 0013, `wakeFromModel` in `watches.ts`) for a question the rules missed, unless the session moved on meanwhile; `RAILS_DECISIONS=shadow` keeps it to judging.
- **Customize** (ADR 0025): what Sprockets can use, broadcast as `customize.changed`.
  - **MCP servers** (`mcp.ts`, `mcp_servers`): a local command (stdio) or a URL (Streamable HTTP), connected with
    `@earendil-works/pi-mcp` when a run first needs one and closed after 5 idle minutes. Environment and header values
    are in `RAILS_HOME/mcp-secrets.json` (0600), never in the database or the API. A local server gets the panels'
    cleaned environment (no `RAILS_*`) plus its own. Each connection lists the tools and keeps them, with each tool's
    allow, ask or off (`policies`; read-only tools start as allow). Routes: `GET/POST /api/mcp`, `PUT/DELETE
    /api/mcp/:id`, `POST /api/mcp/:id/test`.
  - **Signing in to remote servers** (OAuth, in `mcp.ts`, through `@earendil-works/pi-mcp/oauth`): `POST
    /api/mcp/:id/sign-in` discovers the service's sign-in server, registers Rails (or uses the user's `clientId` and
    `clientSecret`) and returns the page to open as `signIn.authUrl`; the browser comes back to a listener on
    `127.0.0.1:${RAILS_MCP_OAUTH_PORT}/mcp/oauth/callback` (signin.ts' `awaitRedirect`), or the user pastes that
    address (`POST …/sign-in/address`). `DELETE …/sign-in` cancels, `POST …/sign-out` forgets the tokens. Tokens
    and the registered app are kept in `mcp-secrets.json` (pi-mcp's `McpOAuthState`); a signed-in connection
    renews them on a 401. A 401 on connecting or on a call sets the status `SIGN_IN_NEEDED`. The sign-in state
    reaches browsers as `McpServer.signIn` (with `customize.changed`).
  - **Tools in runs** (`harness/mcpTools.ts`): a Sprocket's servers (`sprocket_tools`) become capabilities named
    `<server>_<tool>`, in direct and team chats only. Results are labelled as data from the server, cut at 20,000
    characters. An ask tool's call doesn't run: it goes on a card as an **action** (ADR 0031; the run's calls share
    one card, `card.actions`), and the turn goes on. `POST /api/cards/:messageId/actions` (`cardActions.ts`, body
    `{ index?, run }`) runs one (Rails re-checks the policy and calls it on the server, keeping the result) or skips
    it, or all still waiting; once every action is settled, the Sprocket that proposed them gets one run (trigger
    `actions`), which sees what came of each as Rails' note on the card. Older **approvals** (a message with
    `approval`, the run `waiting`) still decide through `POST /api/approvals/:messageId` (`approvals.ts`).
  - **Skills** (`skills.ts`): `RAILS_HOME/skills/<id>/SKILL.md` folders, written in Customize or copied in from
    `~/.agents/skills`, `~/.claude/skills`, `~/.pi/agent/skills` or the native folder picker (no symlinks, at most 200
    files and 5 MB). A Sprocket's skills are listed in its instructions in every chat, and `read_skill`
    (`harness/skills.ts`) reads SKILL.md or a text file beside it. Routes under `/api/skills` (`sources`, `import`).
  - **Saved prompts** (`customize.ts`, `saved_prompts`, `/api/prompts`): every Sprocket can read them
    (`saved_prompts`, `harness/prompts.ts`); a prompt's "Use on Home" goes to `#/new/<promptId>`, which fills Home's
    composer, and they also fill Sprocket chats' composer (`SavedPromptsMenu`).
  - **Connectors** (`packages/shared/src/connectors.ts`): the MCP servers Rails knows, each with how it connects.
    `POST /api/connectors/:id` (`addConnector` in `mcp.ts`, with `{ token }` for one that takes a token) makes a
    server from the entry (`mcp_servers.connector`), then signs in, connects, or (the user's own app) just adds it;
    a folder comes from the native picker. An entry can say all its tools only read (DeepWiki), so they start as Allow.
  - The web pages are the tabs `#/customize` (connectors), `#/customize/skills` and `#/customize/prompts`, and one item:
    `#/customize/connectors/<connectorId>` (not added yet), `#/customize/mcp/<id>`, `#/customize/skills/<id>` and
    `#/customize/prompts/<id>`.
    Agent profiles (ADR 0020) are gone; their table stays, unread.
- **Persistence:** panels survive browser disconnects and server restarts (`tsx watch` included).
  On a reboot the tmux server is gone; the next workspace read drops panels whose tmux session no
  longer exists. Their transcripts remain, so sessions can be resumed from the sidebar.
- **Layout:** the web app saves dockview's `toJSON()` per project (`PUT /api/projects/:id/layout`). The
  server stores it opaquely. The server's panel list is the source of truth: on load the client
  restores the layout, then adds panels missing from it and removes ones that were closed.
  `panels.changed` broadcasts keep other devices' panel lists current. Beside the panes, a side panel
  (`SidePanel.tsx`) shows the project's chat with its Sprocket (one per project, ADR 0016, 0021), its files (a tree with each file's git state, `tree.ts`) or Git; panels with a suggested reply waiting
  (`Sprocket.pending`) get a mark on their tab.
- **Sprockets** (ADR 0005, 0006): `sprockets.ts` stores Sprockets, their chats and settings (project, model,
  description, whether it's its project's Coordinator; core memory stays internal) in SQLite and broadcasts `sprockets.changed`.
  Each has its direct chat, and an attached one its project's chat, where events land (ADR 0021, `sprocket_chats`;
  `GET`/`POST /api/chats/:id/messages`, `DELETE` to clear). Team chats (ADR 0022, `teams.ts`, `/api/teams`) hold two to four
  Sprockets: the user's message goes to the members it @mentions (`@everyone` for all), else (a tapped option) to
  whoever asked, else to members whose questions wait, else the lead (no model guesses, ADR 0023); members pass the
  turn with `pass_turn` (ADR 0023, `harness/turns.ts`), back and forth too, at most 10 in a row, and one that asks a teammate
  without passing is reminded once. Replies show a bubble per paragraph, one after another (`bubbles.ts`). Runs are rows
  (`sprocket_runs`, ADR 0023): a user message, a pass or (for a Coordinator) an event queues one in that chat (`runs.ts`), one
  chat at a time per Sprocket and one run at a time per chat; outside the project chat a run posts each text as its own message,
  can `send_message`, `show_card` (a card: table, facts, list, checklist, code or diff, ADR 0024) and `ask_user`, with options to tap or none (its run then waits for the answer). Each run is a
  pi-agent-core loop on the Sprocket's model, streamed to browsers as `sprockets.typing`, capped at 12 model
  calls (a request that hears nothing for 20 s is sent again, `resend.ts`), 30 runs per Sprocket per hour and 2 runs at once. Its one tool is codemode (ADR 0008,
  `harness/codemode.ts`): scripts run in pi's QuickJS sandbox and call the Sprocket's capabilities (`harness/`:
  memory; and for attached Sprockets the board, sessions, git and read-only files, `files.ts`). Each call's step goes
  to browsers as `sprockets.activity`, and the run's summary is saved on the reply (the run log). `models.ts` holds the model providers (pi-ai),
  the default model and sign-ins; credentials are in `RAILS_HOME/credentials.json`. `signin.ts` runs the
  sign-ins (ChatGPT, OpenRouter) itself and stores pi-ai's credential shape; callbacks land on the server's
  `127.0.0.1` (OpenAI: port 1455). The web renders each Sprocket as an SVG character from data
  (`components/sprockets/`); idle motion is CSS, eyes follow the pointer only in the creator, and the
  loops stop when the OS asks for reduced motion.
- **Automations** (ADR 0032, `automations.ts`, `/api/automations`): a Sprocket, a prompt and a schedule (`schedules.ts`:
  presets or a cron, in a timezone, through croner; at most every 15 minutes). The server keeps each one's next run and
  looks every 30 s: one that's due posts its line in the Sprocket's direct chat (author `automation`) and queues a run
  there (trigger `automation`), once however many times it was missed while the server was off, and never while its
  last run still goes (Skipped). The run's turn note says when its last run was and what it reported, and it may end
  with `nothing_new` (its line is hidden, the run is Nothing new). When the run ends, the automation records Done, Needs
  you (a card or question waits), or Failed, and turns itself off after 3 failures in a row. Changes broadcast
  `automations.changed`. Templates (`web/src/components/automate/templates.ts`) are web-only: one fills in a new
  automation's name, prompt and schedule, and nothing records where it came from.
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

| Provider | Discovery | Panels (new / resume) |
| --- | --- | --- |
| claude | ✅ `~/.claude/projects/*/*.jsonl` | ✅ `claude --session-id <uuid> [-- prompt]` / `claude --resume <id>`; follows `/clear` and `/resume` (ADR 0007) |
| pi | ✅ `~/.pi/agent/sessions/*/*.jsonl` | ✅ `pi --session-id <uuid> [-- prompt]` / `pi --session <id>`; follows `/new`, `/resume` and `/fork` (ADR 0007) |
| codex | ✅ `~/.codex/sessions/**/rollout-*.jsonl`, names from `~/.codex/session_index.jsonl` (checked with Codex 0.163) | ✅ new: Rails starts the thread with its agent tools and runs `codex resume <id> [-- prompt]` (ADR 0030), or plain `codex [-- prompt]` in a folder Codex doesn't trust yet, which learns its session id from Codex's daemon; `codex resume <id>`; follows `/new`, `/fork` and `/resume` (ADR 0007) |

Any `-c`, `--enable`, `--disable` or `--search` flag makes Codex leave its daemon (ADR 0007), so Rails passes Codex
none.

Every provider panel reports to the bridge (ADR 0007): Claude Code through hooks, pi through the Rails
extension, Codex through its app-server daemon. Edits count for overlaps (ADR 0014) once they worked: Claude
Code's PostToolUse, pi's tool end without an error, Codex's completed file changes (checked live with all
three). Files changed by shell commands count too (ADR 0016). Permission waits say what they're for (ADR 0026):
Claude Code's `PermissionRequest` input, Codex's approval requests from its daemon (checked live with 0.163), and
the call pi was running when an unknown dialog opened. Rails answers some pi dialogs itself (ADR 0027): pi's own
select and input, wrapped by the Rails extension, and `@juicesharp/rpiv-ask-user-question` 2.13.9+ through its
`rpiv:ask-user:answer` event; Codex's questions (`request_user_input`) are answered by steering its turn
(`turn/steer`); Claude Code's question dialog through Rails' mod (ADR 0028: `--plugin-dir` with a copy in
`RAILS_HOME/claude-mod`, Claude Code 2.1.287+); other dialogs are answered in the panel.

Agent tools (ADR 0018): Claude Code and pi panels get Rails' MCP server at `/bridge/<panel>/mcp`, behind the
panel's token (`agentTools.ts`): Claude Code from `--mcp-config`, pi from the Rails extension. A new Codex panel
gets them as dynamic tools on a thread Rails starts for it on Codex's daemon (ADR 0030), in a folder Codex trusts. `neighbours` shows an
agent the other sessions in its project; `message` drafts a message for one of them, which waits in the
Coordinator's chat until the user sends it (no model runs); `wait_for` waits, up to 100 seconds a call, until
another session ends its turn, stops, fails or needs its user. Codex sessions from before, from plain `codex` (a
folder Codex doesn't trust yet) or from `/new` get none, but they receive messages.

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
| `RAILS_HOME` | `~/.rails` | DB, config, `tmux.sock` and `tmux.conf` |
| `RAILS_HOST` | `127.0.0.1` | bind address |
| `RAILS_PORT` | `4317` | server port (Vite dev runs on 5173 and proxies to it) |
| `RAILS_TOKEN` | generated | access token override |
| `RAILS_MCP_OAUTH_PORT` | `4328` | where signing in to a remote MCP server sends the browser back (`127.0.0.1`, ADR 0025) |
| `RAILS_DECISIONS` | — | `shadow`: the decision model only judges and logs, never wakes the Coordinator (for evaluating a model, ADR 0013) |
| `CLAUDE_HOME` / `PI_HOME` / `CODEX_HOME` | `~/.claude`, `~/.pi/agent`, `~/.codex` | provider store roots |

Attach to a panel from a normal terminal: `tmux -S ~/.rails/tmux.sock ls`, then
`tmux -S ~/.rails/tmux.sock attach -t p-<panelId>`.
