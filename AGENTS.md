# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: Rails

Rails is a self-hosted web app that acts as a multiplexer for coding agents. You attach project
directories, it finds the Claude Code, Codex and pi sessions that already exist for them, and each
project gets a workspace of terminal panels running the agents' own TUIs (split, resize, drag), shared
across devices (ADR 0003). "Rails" is only a name. This is **not** Ruby on Rails. Write the name as "Rails" in UI
copy and docs; identifiers stay lowercase (`~/.rails`, `RAILS_HOME`, `@rails/*`, `rails.db`).

Scope is exactly three agents: Claude Code, Codex and pi (ADR 0002). Put effort into deeper support
for these three, not into adding providers.

## Read first
1. `docs/CONTEXT.md` is the glossary. Use its terms (Project, Provider, Session, Transcript, Workspace, Panel…) in code and UI. Add a new concept there before using it.
2. `docs/architecture.md` covers the runtime picture, panel lifecycle, provider support matrix, requirements and env vars.
3. `docs/adr/` holds the decisions. Read the ADRs before changing anything foundational.
4. `DESIGN.md` is the visual design system: colors, type, layout, shapes, components and the rules. Read it before any UI work.

Read these when relevant: `docs/providers.md` before touching a parser or adapter, and `docs/roadmap.md`
for future ideas, which aren't commitments. Reference screenshots for the look are in `scratch/visual-overhaul/` (gitignored, so they may be missing in a fresh clone).

## Code map
| Path | What lives there |
| --- | --- |
| `packages/shared/src/index.ts` | All domain and wire types, including the WebSocket protocol (`ClientMsg` / `ServerMsg`). No runtime deps. |
| `packages/server/src/index.ts` | Hono routes, token auth, WebSocket upgrade, static serving in prod. |
| `packages/server/src/config.ts` | Env vars and paths, plus the token in `~/.rails/config.json`. |
| `packages/server/src/projects.ts` | Project services (`attachProject`, `attachPickedFolder`, `detachProject`, `getProject`, `listProjectSessions`). Expected failures throw `ServiceError` (`errors.ts`), which carries an HTTP status; `app.onError` turns it into a JSON error. |
| `packages/server/src/picker.ts` | The OS-native folder picker for Add project (macOS osascript, Linux zenity/kdialog, Windows PowerShell). It opens on the server's screen (ADR 0004). |
| `packages/server/src/panels.ts` | Panel services (`getWorkspace`, `openPanel`, `closePanel`, `saveLayout`) and the CLI command line for each panel kind. Emits `onPanelsChanged`. |
| `packages/server/src/tmux.ts` | Everything tmux: private socket and config in `RAILS_HOME`, start/kill sessions, which panels are still running, `attach()` in a node-pty PTY, the cleaned environment. |
| `packages/server/src/terminals.ts` | `TerminalHub`: one tmux client per (browser, panel), streams `term.*` messages, removes panels whose process exited (`panelEnded`), broadcasts `panels.changed`. |
| `packages/server/src/db.ts` | SQLite via `node:sqlite` (write-ahead logging): projects, panels, layouts, Sprockets and their state. |
| `packages/server/src/names.ts` | Session names (ADR 0019): the name the user gives a session in Rails (`nameSession`; `session_names` in the DB), shown instead of the agent's title. The web side is `RenameSession.tsx`, opened from a sidebar row's menu or a tab's double-click. |
| `packages/server/src/titles.ts` | `sessionTitle(panel)`: a session's title as the user sees it (its Rails name first). Depends only on the database and discovery, so any service can use it without an import cycle. |
| `packages/server/src/git.ts` | Read-only git status and diff through the git CLI. |
| `packages/server/src/tree.ts` | The file tree (side panel's Files tab): one folder at a time with each entry's git state, and read-only previews (the secret policy of `files.ts`). |
| `packages/server/src/providers/` | One discovery adapter per provider (`scan`: cwd, title, dates from the head/tail of each transcript). `index.ts` holds the registry and `installed()`. |
| `packages/web/src/components/Workspace.tsx` | The workspace: dockview layout (`Dock`), tabs, `+` menu, the side panel's toggles, and the one-panel-at-a-time mobile view. Data comes from `useWorkspace.ts`. |
| `packages/web/src/components/SidePanel.tsx` | The panel beside a workspace, behind one toggle: tabs for the project's Sprockets' chats (where suggested replies wait), Files (`FilesPanel.tsx`) and Git (`GitPanel.tsx`). Rows of tabs take arrow keys through `tabKeys.ts`. |
| `packages/web/src/components/FolderMenu.tsx` | The Add project menu: search + recent agent folders + "Open folder…" (native picker). Popover placement comes from `usePopover` in `Menu.tsx`. |
| `packages/server/src/sprockets.ts` | Sprocket services (ADR 0005, 0006): create/rename/delete, settings (project, model, description, Coordinator), and its chats (ADR 0021): the direct chat and the project chat, messages and Clear. Core memory is internal (`runs.ts`, never sent to browsers). Emits `onSprocketsChanged`. |
| `packages/server/src/teams.ts` | Team chats (ADR 0022, 0023): make, edit and delete them, and who answers the user (who's @mentioned or `@everyone`, else whoever asked an option that was tapped, else the decision model's pick, else members whose questions wait, else the lead). Runs themselves, and passing the turn, are `runs.ts`'s. |
| `packages/server/src/runs.ts` | Sprocket runs (ADR 0006, 0023): runs as rows (`sprocket_runs`: queued, running, waiting, done…), one turn engine for every chat, one bounded pi-agent-core loop per run, the runaway guards. Capabilities that end a turn (`pass_turn`, `ask_user`) and `send_message` are in `harness/turns.ts`; `resend.ts` sends a model request again when it hears nothing back. |
| `packages/server/src/models.ts` | Model providers for Sprockets (pi-ai): API keys, sign-in, the default model. Credentials live in `credentials.ts` (`RAILS_HOME/credentials.json`). |
| `packages/server/src/watches.ts` | Watches (ADR 0009): when a session waits for the user, wake its project's Coordinator with an event (grace period, cooldown, `looksLikeQuestion`). |
| `packages/server/src/overlaps.ts` | Overlaps (ADR 0014): files two live sessions changed in the last 30 minutes, broadcast as `panels.overlaps` (tab marks), and the Coordinator's wake for the session that changed them second (batched, once per pair and file). |
| `packages/server/src/handoffs.ts` | Handoffs (ADR 0015): plan, carry out, cancel and expire them (the capabilities are in `harness/reply.ts`; `watches.ts` wakes the Coordinator when a handoff's session finishes a turn). |
| `packages/server/src/owners.ts` | Owners (ADR 0016): which files a session owns, set by the Coordinator's `set_owner`; used for routing and owned-file events in `overlaps.ts`. |
| `packages/server/src/shellEdits.ts` | Edits made by shell commands (ADR 0016): `git status` and file times at a command's start and end, recorded as that session's edits. |
| `packages/server/src/agentTools.ts` | Agent tools (ADR 0018): the MCP server agents in panels reach at `/bridge/<panel>/mcp` (Claude Code via `--mcp-config`, pi via the extension), with `neighbours` (the other sessions, without their prompts or commands) `message` (a draft for another session, shown in the Coordinator's chat for the user to send) and `wait_for` (until another session finishes its turn). |
| `scripts/test-run/` | The test-run harness: setup, watch, act as the user, report, cleanup (README there). Typechecked with the rest. |
| `scripts/coordinator-check/` | Replays test run 2's situations against the real Coordinator on a real model and checks its drafts (README there). Run it after changing the Coordinator's instructions (`runs.ts`, `harness/reply.ts`). |
| `packages/server/src/suggestions.ts` | Suggested replies (ADR 0010): what a Coordinator may suggest, sending (with every check again), dismissing, expiry. The capability is `harness/reply.ts`; delivery into Claude Code, pi and Codex is `bridge/deliver.ts`. |
| `packages/server/src/decisions.ts` | The decision model (ADR 0012, 0013): typed questions about turn ends and unknown dialogs, the guards, the shadow log, and the wakes it may add. |
| `packages/server/src/bridge/` | The bridge (ADR 0007): how agents report (`wiring.ts` flags, `pi/rails.ts` extension, `codex.ts` daemon client), the event shape (`events.ts`), the board and attention (`board.ts`, `index.ts`). |
| `packages/server/src/harness/` | The Sprocket harness (ADR 0008): capabilities (`capabilities.ts`; `project.ts` for the board, sessions, git and files; `memory.ts`; `cards.ts` for `show_card`, ADR 0024) reached through one codemode tool (`codemode.ts`, after pi's, in `@earendil-works/pi-codemode`'s sandbox). A new ability is a new capability. `files.ts` holds the read-only, secret-refusing file access. `prompts.ts` gives every Sprocket the saved prompts (ADR 0020). |
| `packages/server/src/customize.ts` | Customize (ADR 0025): what Sprockets can use. This file holds saved prompts and `customizeChanged`; MCP servers are `mcp.ts` (the library, secrets in `RAILS_HOME/mcp-secrets.json`, connections through `@earendil-works/pi-mcp`, signing in to remote ones with OAuth), skills `skills.ts` (`RAILS_HOME/skills/<id>/SKILL.md`), approvals of MCP calls `approvals.ts`. Their capabilities are `harness/mcpTools.ts` and `harness/skills.ts`. |
| `packages/web/src/components/customize/` | The Customize page (`CustomizePage`: tabs of cards, Yours and Discover), a connector's page (`ConnectorPage`), the editors (`McpEditor`, `SkillEditor`, `PromptEditor`, shared `fields.tsx`), connector marks (`ConnectorLogo`, `logos.ts` from simple-icons) and `SavedPromptsMenu`. The catalog is `packages/shared/src/connectors.ts`. A Sprocket picks its connectors and skills in its settings panel (Tools); an MCP call that asks shows as `sprockets/ApprovalCard.tsx`. |
| `packages/server/src/account.ts` | Settings → Account and General: sign out everywhere (replaces the access token), facts about this server. |
| `packages/server/src/profile.ts` | The profile: the name and avatar at the foot of the sidebar (avatars in `web/src/assets/avatars/`, ids in `PROFILE_AVATARS`). |
| `packages/web/src/components/settings/` | The Settings modal (`SettingsDialog`, opened with `useOpenSettings()` from `context.ts`, e.g. by the sidebar's account row), its sections (General, Providers, Models, Account) and its search (`search.ts`). |
| `packages/server/src/signin.ts` | Rails' own "Continue with ChatGPT" and OpenRouter sign-in flows (so every page says Rails); they store credentials in pi-ai's shape (ADR 0006). |
| `packages/web/src/components/sprockets/` | The Sprockets page (`SprocketsPage`, `SprocketCreator`, `SprocketChat`, `SprocketSettings`, `TeamDialog`, `TeamSettings` and `TeamFace` for team chats) and the character renderer (`Sprocket.tsx`: `characters.ts` data, `parts.tsx` accessories, `motion.ts` blinks/look-at/one-shots; idle loops in `styles.css`). |
| `packages/web/src/components/TerminalView.tsx` | One xterm.js terminal attached to a panel over the shared socket; re-attaches on reconnect, reports resizes. |
| `packages/web/src/` | React SPA. `store.tsx` holds global state, `ws.ts` the shared socket with reconnect, `router.ts` hash routing, `api.ts` the REST client, `theme.ts` the appearance (Light, Dark or System, per browser; ADR 0017, applied before the first paint by `index.html`), `styles.css` all CSS (tokens and both palettes at the top), `components/` the UI. |

## Where to change what
- **New WebSocket message:** add the type in `shared`, handle it in `TerminalHub.handle`, then handle it in the web listener (usually `TerminalView.tsx`, `useWorkspace.ts` or `store.tsx`).
- **New REST endpoint:** put the logic in a service module, add a thin route in `server/src/index.ts`, then add the client method in `web/src/api.ts`.
- **How an agent is launched:** `command()` in `panels.ts` (flags for new vs resumed sessions). tmux behaviour (mouse, keys, sizing) lives in the config written by `tmux.ts`.
- **Transcript parsing:** edit `providers/<id>.ts`, and update `docs/providers.md` with anything you learn about the format.
- **App settings** go in the Settings modal (`components/settings/`): sections of groups (a heading on a rule, then rows of label, description and control), as in DESIGN.md's Dialogs. Give each row `id="setting-<rowId>"`, `data-settings-row` and `tabIndex={-1}`, and add it to `SETTINGS` in `search.ts` (label plus synonyms) so search finds it. Customize is for what Sprockets use (MCP servers, skills, prompts), not app settings.
- **UI:** follow `DESIGN.md`. Reuse the tokens in `styles.css` (never a new hex; a new token gets a value in both the dark and the light palette) and check both themes, use `@tabler/icons-react` for icons (MIT), `var(--font)` / `var(--grotesk)` / `var(--mono)` for text (Inter, Space Grotesk and Space Mono, bundled via `@fontsource`; no CDN fonts, and terminals keep the system monospace on purpose for glyph coverage), `ProviderIcon` for agent logos and `MenuButton` (`components/Menu.tsx`) for dropdown menus and `Dropdown` (`components/Dropdown.tsx`) instead of a native `<select>`. The `better-*` skills in `.agents/skills/` cover UI review work.

## Commands and verification
- `make` lists the targets, which wrap the npm scripts. `make dev`/`start`/`install` first run `make system-deps`, which installs tmux (required) if it's missing. `make dev` runs the server on :4317 and Vite on :5173. Open the printed `?token=` URL.
- Optional pinned toolchain: `nix develop` (flakes may need `--extra-experimental-features 'nix-command flakes'`), then `make` as usual. Keep `flake.nix` to system tools only: no npm packaging, no agent CLIs. Update pins with `nix flake update`.
- `make typecheck` must pass. `make start` builds and runs prod, where the server serves `web/dist`. `make token` prints the access token.
- `make test` runs the tests (Vitest, `packages/*/src/**/*.test.ts`) and must pass. Tests get throwaway homes (`vitest.config.ts`, `vitest.setup.ts`), and Sprocket runs use pi-ai's scripted faux provider, never a real model. Also verify with typecheck, `curl` against the API and a browser check.
- Use throwaway state with `make dev-tmp` (LAN-reachable, `/tmp/rails-dev`, token `t`) or `RAILS_HOME=/tmp/x RAILS_TOKEN=t`. For `curl`, log in first with `POST /api/auth/login {"token":…}` and keep the cookie.
- Browser checks: start dev with `make dev-tmp` (or `make dev-lan`) and open the printed `?token=` URL. A browser on another device reaches it through the host's LAN or Tailscale address.
- Panel tests run real agents with your logins. Use a scratch directory, then delete the transcripts they leave (`~/.claude/projects/-private-tmp-…`, `~/.pi/agent/sessions/--private-tmp-…--`, Codex threads with `codex delete --force <id>`, plus the `[projects."<scratch dir>"]` entry Codex adds to `~/.codex/config.toml` when you trust the folder) and kill the throwaway tmux server (`tmux -S $RAILS_HOME/tmux.sock kill-server`).
- The Coordinator's drafts: `npm run coordinator-check -- [--model …] [--repeat 3]` (`scripts/coordinator-check/README.md`). It needs a provider signed in once in its home (`/tmp/rails-check`) and costs cents on a small model.
- Whole test runs (real agents on a brief, a Sprocket coordinating, you as the user): `npm run test-run -- …` (`scripts/test-run/README.md`). It sets up, watches, logs your decisions, reports and cleans up after itself.
- Never resume or open the user's real sessions in tests: `claude --resume` appends lines to the transcript even if you type nothing. Create scratch sessions instead.
- Never kill tmux servers or Rails processes you didn't start: the user's own `make dev` may be running on :4317/:5173, so test on other ports (`RAILS_PORT=4319`, `npx vite --port 5180`).

## Branching
- Work that's experimental, likely to be rolled back, or large (a new subsystem, a change across server and web, anything the user calls "try" or "experimental") goes on its own branch: `git switch -c <short-name>`. Use a worktree (`git worktree add ../rails-<name> -b <name>`) if `make dev` is running on main.
- Small, clearly requested changes go straight to main as small commits.
- Merge into main only when the user says to keep it. If it's dropped, delete the branch instead of reverting on main.
- If it's unclear whether something counts as experimental, ask before starting.

## Invariants
- Provider transcripts are the source of truth for sessions. Rails reads them and **never writes** them (the agents do, inside panels). The DB only stores projects, panels and layouts.
- Panel processes live in tmux, not in the server. A browser disconnecting or the server restarting must never kill an agent; only closing the panel does.
- The server's panel list is the source of truth; the saved layout is only an arrangement. Reconcile layout against the list, never the other way round.
- The access token must never reach panel processes: keep the env cleaning in `tmux.ts`. Panels get only their own bridge token (ADR 0007).
- Wire agents to the bridge with command-line flags only (`bridge/wiring.ts`); never write the user's agent settings files. Codex panels must start without `-c` flags, or Codex leaves its daemon and Rails can't see them.
- Discovery must stay cheap. Provider stores can be huge (a pi store can reach hundreds of MB), so scans read only the head and tail of each file and cache by mtime and size. Never read whole files during a scan.
- The web client must work over plain HTTP on the LAN or Tailscale, so don't use secure-context-only browser APIs (for example `crypto.randomUUID` or the async clipboard API).
- Keep server logic in plain service functions, not inside Hono route handlers. Routes should only parse input and call services, so Sprockets can reuse those services as tools.
- Project paths are stored as realpaths, because agents record the real cwd (on macOS, `/tmp` is really `/private/tmp`).

## Gotchas
- Don't use `$SHELL` for the user's shell: `nix develop` sets it to its own bash. Shell panels use `os.userInfo().shell`.
- The server needs tmux >= 3.2 (`make system-deps` or `nix develop`). Every Rails home has its own tmux server (`$RAILS_HOME/tmux.sock`); panels survive server restarts but not a reboot.
- node-pty's `spawn-helper` must be executable; the root `postinstall` fixes it. "posix_spawnp failed" means it didn't run.
- xterm.js puts the class `terminal` on its own root, so don't use that class name for wrappers.
- The dock's look (`styles.css`) maps dockview's `.dockview-theme-dark` variables to the tokens (so it follows either theme) and styles its tab strips through dockview's own classes (`.dv-tab`, `.dv-active-tab`, `.dv-active-group`, `.dv-tabs-and-actions-container`). Panes share dockview's 1px separator and 4px sash. `dockview-react` is pinned to `~8.5.1`; after upgrading it, re-check the tab underlines and dragging.
- Terminals render with WebGL (`@xterm/addon-webgl`). xterm's DOM renderer lets rows drift wider than the grid (fallback glyphs like `─` and `•`), which clips the right edge. Keep padding off `.term-host`: the fit addon sizes from that element's CSS width.
- Agent TUIs hard-wrap their output, so lines printed before a pane was narrowed stay clipped. That's normal terminal behaviour.
- Imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`). The server runs TypeScript directly through `tsx` and has no build step.
- Sprocket SVGs: a CSS `transform` replaces the SVG `transform` attribute, so position with an outer `<g transform>` and animate an inner group (`transform-box: fill-box`). Headless browsers often report reduced motion, which stops Sprocket animations: emulate `prefers-reduced-motion: no-preference` to check them.
- Upgrading pi-ai (`@earendil-works/pi-ai`, pinned `~1.3`): `signin.ts` runs the sign-in flows itself but stores pi-ai's credential shape, and pi-ai refreshes those tokens. `make test` (`signin.test.ts`) fails if the shape no longer fits; also compare `signin.ts` with pi-ai's `dist/auth/oauth/openai-chatgpt.js` and `openrouter.js` for flow changes (ADR 0006).
- Codex is the least tested provider (checked live with 0.163: panels, events, replies, overlaps, handoffs; not yet its dialogs or replies queued while it's busy): check Codex changes against a real Codex install. Codex 0.16x runs interactive sessions on a shared app-server daemon (other clients see its threads), and any `-c` override makes it run without the daemon (see `docs/providers.md`). A brand-new thread can't be subscribed to (`thread/resume`) until Codex has saved its first turn.

## Long-term direction
Rails may ship as a desktop app later. A Node-based shell such as Electron is fine, so the Node server can
stay; the earlier Rust port idea is dropped (see `docs/roadmap.md`). Keep logic in plain service functions
and the client/server contract fully described by the types in `packages/shared`.

## Keeping docs current
Update the docs in the same change as the code:
- Provider capability changes go in the matrix in `architecture.md` and the status list in `README.md`.
- Format discoveries go in `providers.md`.
- New terms go in `CONTEXT.md`.
- New or changed foundations get a new numbered ADR. Never quietly break an existing one.
- Remove finished items from `roadmap.md`.
- Visual changes (tokens, type, shapes, components, rules) go in `DESIGN.md`. Its color front matter mirrors `styles.css`, and `design.test.ts` fails if they differ.
- Describe designs in their own terms: no other products as references ("like X's") in docs, comments or commit messages.
- Keep this file short: a map and rules. Detail belongs in `docs/`.
