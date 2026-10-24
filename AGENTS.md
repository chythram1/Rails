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
| `packages/shared/src/index.ts` | All domain and wire types, including the WebSocket protocol (`ClientMsg` / `ServerMsg`). No runtime deps. The connector catalog is `connectors.ts`. |
| `packages/server/src/index.ts` | Startup: starts the services, serves the app, the WebSocket upgrade, shutdown. |
| `packages/server/src/app.ts` | The Hono app: token auth, origin checks, bridge auth, every route, static serving in prod. `app.test.ts` checks the auth with `app.request()`. |
| `packages/server/src/` (root) | `config.ts` env vars and paths (and the token in `~/.rails/config.json`); `db.ts` SQLite via `node:sqlite` (write-ahead logging), every table, `tx()` for writes that go together; `errors.ts` `ServiceError`, an expected failure with its HTTP status (`app.onError` turns it into a JSON error); `util.ts` change listeners and `sameSecret`. |
| `packages/server/src/workspace/` | A project's workspace: projects (`projects.ts`), the OS-native folder picker (`picker.ts`, ADR 0004), panels and each kind's command line (`panels.ts`), everything tmux (`tmux.ts`: private socket and config, the cleaned environment), `TerminalHub` (`terminals.ts`: one tmux client per browser and panel, and the push channel for every `*.changed`), session names (`names.ts`, ADR 0019) and titles (`titles.ts`, which depends only on the database and discovery so anything can use it), git, the file tree (`tree.ts`), and read-only, secret-refusing file access (`files.ts`). |
| `packages/server/src/providers/` | One discovery adapter per provider (`scan`: cwd, title, dates from the head/tail of each transcript). `index.ts` holds the registry and `installed()`. |
| `packages/server/src/bridge/` | The bridge (ADR 0007): how agents report (`wiring.ts` flags, `pi/rails.ts` extension, `codex.ts` daemon client), the event shape (`events.ts`), the board and attention (`board.ts`, `index.ts`), delivering replies (`deliver.ts`; pi dialogs through the extension, ADR 0027; Claude Code's question dialog through Rails' mod, `claude/mod`, ADR 0028), and agent tools (`agentTools.ts`, ADR 0018: the MCP server at `/bridge/<panel>/mcp` with `neighbours`, `message` and `wait_for`; Codex gets them as dynamic tools, ADR 0030). |
| `packages/server/src/sprockets/` | Sprockets (ADR 0005, 0006) and their chats (ADR 0021): the services (`sprockets.ts`), team chats and who is woken (`teams.ts`, ADR 0022, 0033), the run engine (`runs.ts`: runs as rows, one bounded pi-agent-core loop per run, the runaway guards), what the model reads (`prompt.ts`: system prompt, events, reminders, the Sprocket's other chats, ADR 0034), team members and waiting questions (`members.ts`), resending a request that hears nothing back (`resend.ts`), and cards that act (`cardActions.ts`, ADR 0031; an ask tool's call goes on a card through `propose` in `runs.ts`). |
| `packages/server/src/harness/` | The Sprocket harness (ADR 0008): capabilities (`capabilities.ts`; `project.ts` for the board, sessions, git and files; `memory.ts`; `cards.ts` for `show_card`, ADR 0024; `reply.ts` for the Coordinator's drafts and handoffs; `turns.ts` for `ask_user`, `send_message` and `nothing_new`; `mcpTools.ts` and `skills.ts` for what Customize gives) reached through one codemode tool (`codemode.ts`, after pi's, in `@earendil-works/pi-codemode`'s sandbox). A new ability is a new capability. |
| `packages/server/src/coordination/` | What keeps a project's sessions working together, through its Coordinator: watches (`watches.ts`, ADR 0009, 0026: a session waits for the user), overlaps (ADR 0014), handoffs (ADR 0015), findings (ADR 0029), owners (ADR 0016), edits made by shell commands (`shellEdits.ts`), suggested replies (`suggestions.ts`, ADR 0010: sending with every check again, expiry), and the decision model (`decisions.ts`, ADR 0012, 0013). |
| `packages/server/src/automate/` | Automations (ADR 0032): the service, the scheduler and each run's outcome (`automations.ts`), and when it runs (`schedules.ts`, croner). The run itself is `sprockets/runs.ts` (trigger `automation`). |
| `packages/server/src/customize/` | What Sprockets can use (ADR 0025): saved prompts and `customizeChanged` (`customize.ts`), MCP servers (`mcp.ts`: the library, secrets in `RAILS_HOME/mcp-secrets.json`, connections through `@earendil-works/pi-mcp`, OAuth sign-in), skills (`skills.ts`, `RAILS_HOME/skills/<id>/SKILL.md`), and approvals from before ADR 0031 (`approvals.ts`). |
| `packages/server/src/settings/` | What the Settings dialog shows: model providers, API keys and the default model (`models.ts`), Rails' own ChatGPT and OpenRouter sign-ins (`signin.ts`, in pi-ai's credential shape, ADR 0006), credentials (`credentials.ts`, `RAILS_HOME/credentials.json`), the account and facts about this server (`account.ts`), and the profile (`profile.ts`). |
| `packages/web/src/` | React SPA. `store.tsx` holds global state, `ws.ts` the shared socket with reconnect, `router.ts` hash routing, `api.ts` the REST client, `theme.ts` the appearance (Light, Dark or System, per browser; ADR 0017, applied before the first paint by `index.html`), `styles.css` all CSS (tokens and both palettes at the top). |
| `packages/web/src/components/ui/` | Controls and hooks any page uses: `Dropdown`, `MenuButton` and `usePopover` (`Menu.tsx`), `Switch`, `Segmented`, `ConfirmDialog` (and `showNotice`), `Composer`, `ModelSelect`, `PageNav`, `ProviderIcon`, `Avatar`, `Logo`, `useLive` (data kept current by server messages), `useAutoGrow`, `tabKeys` (arrow keys along a row of tabs). |
| `packages/web/src/components/shell/` | The app's frame: `Sidebar`, `Home` (new chat), `Login`, and `FolderMenu` (Add project: search, recent agent folders, "Open folder…"). |
| `packages/web/src/components/workspace/` | A project's workspace: `Workspace` (the dockview layout, tabs, `+` menu, the one-panel-at-a-time mobile view; data from `useWorkspace.ts`), `TerminalView` (one xterm.js terminal over the shared socket), `SidePanel` with `FilesPanel` and `GitPanel`, `PanelMenu`, and `RenameSession`. |
| `packages/web/src/components/sprockets/` | The Sprockets page (`SprocketsPage`, `SprocketCreator`, `SprocketChat`, `SprocketSettings`, `TeamDialog`, `TeamSettings`, `TeamFace`, `TeamThinking` with `morph.ts`), cards that act (`CardActions.tsx`), and the character renderer (`Sprocket.tsx`: `characters.ts` data, `parts.tsx` eyes, `motion.ts` blinks/look-at/one-shots; idle loops in `styles.css`). |
| `packages/web/src/components/automate/` | The Automate page: Dashboard and Templates (`templates.ts`), the new-automation form and each automation's editor. |
| `packages/web/src/components/customize/` | The Customize page (`CustomizePage`: tabs of cards, Yours and Discover), the dialogs that add a server (`ServerDialogs`), the editors (`McpEditor`, `SkillEditor`, `PromptEditor`, shared `fields.tsx`), connector marks (`ConnectorLogo`, `logos.ts` from simple-icons) and `SavedPromptsMenu`. A Sprocket picks its connectors and skills in its settings panel (Tools). |
| `packages/web/src/components/settings/` | The Settings modal (`SettingsDialog`, opened with `useOpenSettings()` from `context.ts`), its sections (General, Providers, Models, Account) and its search (`search.ts`). |
| `scripts/test-run/` | The test-run harness: setup, watch, act as the user, report, cleanup (README there). Typechecked with the rest. |
| `scripts/coordinator-check/` | Replays test runs' situations against the real Coordinator on a real model and checks its drafts (README there). Run it after changing the Coordinator's instructions (`sprockets/prompt.ts`, `harness/reply.ts`). |

## Where to change what
- **New WebSocket message:** add the type in `shared`, handle it in `TerminalHub.handle`, then handle it in the web listener (usually `TerminalView.tsx`, `useWorkspace.ts` or `store.tsx`).
- **New server module:** put it in the feature folder it belongs to (`workspace/`, `sprockets/`, `coordination/`, …), named as the web's folder for that feature where there is one. The root is only for what every part uses (`config.ts`, `db.ts`, `errors.ts`, `util.ts`) and startup (`index.ts`, `app.ts`).
- **New REST endpoint:** put the logic in a service module, add a thin route in `server/src/app.ts`, then add the client method in `web/src/api.ts`.
- **How an agent is launched:** `command()` in `panels.ts` (flags for new vs resumed sessions). tmux behaviour (mouse, keys, sizing) lives in the config written by `tmux.ts`.
- **Transcript parsing:** edit `providers/<id>.ts`, and update `docs/providers.md` with anything you learn about the format.
- **App settings** go in the Settings modal (`components/settings/`): sections of groups (a heading on a rule, then rows of label, description and control), as in DESIGN.md's Dialogs. Give each row `id="setting-<rowId>"`, `data-settings-row` and `tabIndex={-1}`, and add it to `SETTINGS` in `search.ts` (label plus synonyms) so search finds it. Customize is for what Sprockets use (MCP servers, skills, prompts), not app settings.
- **UI:** follow `DESIGN.md`. Reuse the tokens in `styles.css` (never a new hex; a new token gets a value in both the dark and the light palette) and check both themes, use `@tabler/icons-react` for icons (MIT), `var(--font)` / `var(--grotesk)` / `var(--mono)` for text (Inter, Space Grotesk and Space Mono, bundled via `@fontsource`; no CDN fonts, and terminals keep the system monospace on purpose for glyph coverage), `ProviderIcon` for agent logos and `MenuButton` (`components/ui/Menu.tsx`) for dropdown menus and `Dropdown` (`components/ui/Dropdown.tsx`) instead of a native `<select>`. The `better-*` skills in `.agents/skills/` cover UI review work.

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
- Provider transcripts are the source of truth for sessions. Rails reads them and **never writes** them (the agents do, inside panels). The DB holds Rails' own state (projects, panels, layouts, Sprockets and their chats, Customize, automations), never a session's transcript.
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
