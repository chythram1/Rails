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

# Project: rails

rails is a self-hosted web app that acts as a multiplexer for coding agents. You attach project
directories, it finds the Claude Code, Codex and pi sessions that already exist for them, and each
project gets a workspace of terminal panels running the agents' own TUIs (split, resize, drag), shared
across devices (ADR 0003). "rails" is only a name. This is **not** Ruby on Rails.

Scope is exactly three agents: Claude Code, Codex and pi (ADR 0002). Put effort into deeper support
for these three, not into adding providers.

## Read first
1. `docs/CONTEXT.md` is the glossary. Use its terms (Project, Provider, Session, Transcript, Workspace, Panel…) in code and UI. Add a new concept there before using it.
2. `docs/architecture.md` covers the runtime picture, panel lifecycle, provider support matrix, requirements and env vars.
3. `docs/adr/` holds the decisions. Read the ADRs before changing anything foundational.

Read these when relevant: `docs/providers.md` before touching a parser or adapter, and `docs/roadmap.md`
for future ideas, which aren't commitments. `ref/style.png` (overall look) and `ref/panels.png` (workspace panels) are the visual references (`ref/` is gitignored, so they may be missing in a fresh clone).

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
| `packages/server/src/db.ts` | SQLite via `node:sqlite`: projects, panels, layouts. |
| `packages/server/src/git.ts` | Read-only git status and diff through the git CLI. |
| `packages/server/src/providers/` | One discovery adapter per provider (`scan`: cwd, title, dates from the head/tail of each transcript). `index.ts` holds the registry and `installed()`. |
| `packages/web/src/components/Workspace.tsx` | The workspace: dockview layout (`Dock`), tabs, `+` menu, and the one-panel-at-a-time mobile view. Data comes from `useWorkspace.ts`. |
| `packages/web/src/components/FolderMenu.tsx` | The Add project menu: search + recent agent folders + "Open folder…" (native picker). Popover placement comes from `usePopover` in `Menu.tsx`. |
| `packages/server/src/sprockets.ts` | Sprocket services (ADR 0005): create/edit/delete and their messages. Emits `onSprocketsChanged`. |
| `packages/web/src/components/sprockets/` | The Sprockets page (`SprocketsPage`, `SprocketCreator`, `SprocketChat`) and the character renderer (`Sprocket.tsx`: `characters.ts` data, `parts.tsx` accessories, `motion.ts` blinks/look-at/one-shots; idle loops in `styles.css`). |
| `packages/web/src/components/TerminalView.tsx` | One xterm.js terminal attached to a panel over the shared socket; re-attaches on reconnect, reports resizes. |
| `packages/web/src/` | React SPA. `store.tsx` holds global state, `ws.ts` the shared socket with reconnect, `router.ts` hash routing, `api.ts` the REST client, `styles.css` all CSS (tokens at the top), `components/` the UI. |

## Where to change what
- **New WebSocket message:** add the type in `shared`, handle it in `TerminalHub.handle`, then handle it in the web listener (usually `TerminalView.tsx`, `useWorkspace.ts` or `store.tsx`).
- **New REST endpoint:** put the logic in a service module, add a thin route in `server/src/index.ts`, then add the client method in `web/src/api.ts`.
- **How an agent is launched:** `command()` in `panels.ts` (flags for new vs resumed sessions). tmux behaviour (mouse, keys, sizing) lives in the config written by `tmux.ts`.
- **Transcript parsing:** edit `providers/<id>.ts`, and update `docs/providers.md` with anything you learn about the format.
- **UI:** reuse the tokens in `styles.css`, use `@tabler/icons-react` for icons (MIT), `ProviderIcon` for agent logos and `MenuButton` (`components/Menu.tsx`) for dropdown menus (style: `ref/project-menu.png`). The `better-*` skills in `.agents/skills/` cover UI review work.

## Commands and verification
- `make` lists the targets, which wrap the npm scripts. `make dev`/`start`/`install` first run `make system-deps`, which installs tmux (required) if it's missing. `make dev` runs the server on :4317 and Vite on :5173. Open the printed `?token=` URL.
- Optional pinned toolchain: `nix develop` (flakes may need `--extra-experimental-features 'nix-command flakes'`), then `make` as usual. Keep `flake.nix` to system tools only: no npm packaging, no agent CLIs. Update pins with `nix flake update`.
- `make typecheck` must pass. `make start` builds and runs prod, where the server serves `web/dist`. `make token` prints the access token.
- There's no automated test suite yet. Verify with typecheck, `curl` against the API and a browser check. Don't add a test framework without asking.
- Use throwaway state with `make dev-tmp` (LAN-reachable, `/tmp/rails-dev`, token `t`) or `RAILS_HOME=/tmp/x RAILS_TOKEN=t`. For `curl`, log in first with `POST /api/auth/login {"token":…}` and keep the cookie.
- Browser testing on this machine: use `agent-browser-remote` (see the global AGENTS.md). Start dev with `make dev-tmp` (or `make dev-lan`) and open `http://100.101.76.38:5173/?token=…`. The mac-mini reaches it over Tailscale.
- Panel tests run real agents with your logins. Use a scratch directory, then delete the transcripts they leave (`~/.claude/projects/-private-tmp-…`, `~/.pi/agent/sessions/--private-tmp-…--`) and kill the throwaway tmux server (`tmux -S $RAILS_HOME/tmux.sock kill-server`).
- Never resume or open the user's real sessions in tests: `claude --resume` appends lines to the transcript even if you type nothing. Create scratch sessions instead.
- Never kill tmux servers or rails processes you didn't start: the user's own `make dev` may be running on :4317/:5173, so test on other ports (`RAILS_PORT=4319`, `npx vite --port 5180`).

## Branching
- Work that's experimental, likely to be rolled back, or large (a new subsystem, a change across server and web, anything the user calls "try" or "experimental") goes on its own branch: `git switch -c <short-name>`. Use a worktree (`git worktree add ../rails-<name> -b <name>`) if `make dev` is running on main.
- Small, clearly requested changes go straight to main as small commits.
- Merge into main only when the user says to keep it. If it's dropped, delete the branch instead of reverting on main.
- If it's unclear whether something counts as experimental, ask before starting.

## Invariants
- Provider transcripts are the source of truth for sessions. rails reads them and **never writes** them (the agents do, inside panels). The DB only stores projects, panels and layouts.
- Panel processes live in tmux, not in the server. A browser disconnecting or the server restarting must never kill an agent; only closing the panel does.
- The server's panel list is the source of truth; the saved layout is only an arrangement. Reconcile layout against the list, never the other way round.
- The access token must never reach panel processes: keep the env cleaning in `tmux.ts`.
- Discovery must stay cheap. Provider stores can be huge (pi is about 600MB here), so scans read only the head and tail of each file and cache by mtime and size. Never read whole files during a scan.
- The web client must work over plain HTTP on the LAN or Tailscale, so don't use secure-context-only browser APIs (for example `crypto.randomUUID` or the async clipboard API).
- Keep server logic in plain service functions, not inside Hono route handlers. Routes should only parse input and call services, so the future home agent can reuse those services as tools.
- Project paths are stored as realpaths, because agents record the real cwd (on macOS, `/tmp` is really `/private/tmp`).

## Gotchas
- Don't use `$SHELL` for the user's shell: `nix develop` sets it to its own bash. Shell panels use `os.userInfo().shell`.
- The server needs tmux >= 3.2 (`make system-deps` or `nix develop`). Every rails home has its own tmux server (`$RAILS_HOME/tmux.sock`); panels survive server restarts but not a reboot.
- node-pty's `spawn-helper` must be executable; the root `postinstall` fixes it. "posix_spawnp failed" means it didn't run.
- xterm.js puts the class `terminal` on its own root, so don't use that class name for wrappers.
- Pane gutters (`styles.css`) restyle dockview internals: its `.dv-view` / `.dv-sash` classes and its hard-coded 4px sash, which is widened and shifted 2px. `dockview-react` is pinned to `~8.5.1`; after upgrading it, re-check gutter alignment and dragging.
- Terminals render with WebGL (`@xterm/addon-webgl`). xterm's DOM renderer lets rows drift wider than the grid (fallback glyphs like `─` and `•`), which clips the right edge. Keep padding off `.term-host`: the fit addon sizes from that element's CSS width.
- Agent TUIs hard-wrap their output, so lines printed before a pane was narrowed stay clipped. That's normal terminal behaviour.
- Imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`). The server runs TypeScript directly through `tsx` and has no build step.
- Native `<select>` can't show images, so the home agent picker shows text.
- Sprocket SVGs: a CSS `transform` replaces the SVG `transform` attribute, so position with an outer `<g transform>` and animate an inner group (`transform-box: fill-box`). Headless browsers often report reduced motion, which stops Sprocket animations: emulate `prefers-reduced-motion: no-preference` to check them.
- Codex panels and Codex parsing are untested on this machine (Codex isn't installed).

## Long-term direction
The end goal is to port rails to a single Rust binary that runs as a desktop app (see `docs/roadmap.md`).
Until then, keep the server easy to port: logic in plain service functions, the client/server contract
fully described by the types in `packages/shared`, and no new Node-only dependencies without a good reason.

## Keeping docs current
Update the docs in the same change as the code:
- Provider capability changes go in the matrix in `architecture.md` and the status list in `README.md`.
- Format discoveries go in `providers.md`.
- New terms go in `CONTEXT.md`.
- New or changed foundations get a new numbered ADR. Never quietly break an existing one.
- Remove finished items from `roadmap.md`.
- Keep this file short: a map and rules. Detail belongs in `docs/`.
