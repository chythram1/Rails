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
directories, it finds the Claude Code, Codex and pi sessions that already exist for them, and you can
read those sessions or chat with the agents live from any device. "rails" is only a name. This is
**not** Ruby on Rails.

Scope is exactly three agents: Claude Code, Codex and pi (ADR 0002). Put effort into deeper chat
support for these three, not into adding providers.

## Read first
1. `docs/CONTEXT.md` is the glossary. Use its terms (Project, Provider, Session, Transcript, Live session…) in code and UI. Add a new concept there before using it.
2. `docs/architecture.md` covers the runtime picture, live-session lifecycle, provider support matrix and env vars.
3. `docs/adr/` holds the decisions. Read the ADRs before changing anything foundational.

Read these when relevant: `docs/providers.md` before touching a parser or adapter, and `docs/roadmap.md`
for future ideas, which aren't commitments. `ref/style.png` is the visual reference for the UI (`ref/` is gitignored, so it may be missing in a fresh clone).

## Code map
| Path | What lives there |
| --- | --- |
| `packages/shared/src/index.ts` | All domain and wire types, including the WebSocket protocol (`ClientMsg` / `ServerMsg`). No runtime deps. |
| `packages/server/src/index.ts` | Hono routes, token auth, WebSocket upgrade, static serving in prod. |
| `packages/server/src/config.ts` | Env vars and paths, plus the token in `~/.rails/config.json`. |
| `packages/server/src/projects.ts` | Project services (`attachProject`, `getProject`, `listProjectSessions`). `ServiceError` carries an HTTP status, and `app.onError` turns it into a JSON error. |
| `packages/server/src/db.ts` | SQLite via `node:sqlite`. Only stores projects. |
| `packages/server/src/git.ts` | Read-only git status and diff through the git CLI. |
| `packages/server/src/providers/` | One discovery adapter per provider (`scan`, `readTranscript`) that maps native JSONL to `Message`. `index.ts` holds the registry, `LIVE_PROVIDERS` and the project-suggestion logic. |
| `packages/server/src/live/claude.ts` | `ClaudeLive`: one Claude Agent SDK `query()` per live session, with permission handling. |
| `packages/server/src/live/hub.ts` | `LiveHub`: owns live sessions and sends their events to every subscribed WebSocket client. |
| `packages/web/src/` | React SPA. `store.tsx` holds global state, `ws.ts` the shared socket with reconnect, `router.ts` hash routing, `api.ts` the REST client, `styles.css` all CSS (tokens at the top), `components/` the UI. |

## Where to change what
- **New WebSocket message:** add the type in `shared`, handle it in `LiveHub.handle`, then handle it in the web listener (usually `SessionView.tsx` or `store.tsx`).
- **New REST endpoint:** put the logic in a service module, add a thin route in `server/src/index.ts`, then add the client method in `web/src/api.ts`.
- **Make pi or Codex live:** add a class with the same shape as `ClaudeLive` under `live/`, branch on provider in `LiveHub.spawn`, then add the provider to `LIVE_PROVIDERS`. Message ids must match the ones `readTranscript` produces (see Invariants).
- **Transcript parsing:** edit `providers/<id>.ts`, and update `docs/providers.md` with anything you learn about the format.
- **UI:** reuse the tokens in `styles.css`, use `lucide-react` for icons and `ProviderIcon` for agent logos. The `better-*` skills in `.agents/skills/` cover UI review work.

## Commands and verification
- `make` lists the targets, which wrap the npm scripts. `make dev` runs the server on :4317 and Vite on :5173. Open the printed `?token=` URL.
- `make typecheck` must pass. `make start` builds and runs prod, where the server serves `web/dist`. `make token` prints the access token.
- There's no automated test suite yet. Verify with typecheck, `curl` against the API and a browser check. Don't add a test framework without asking.
- Use throwaway state with `make dev-tmp` (LAN-reachable, `/tmp/rails-dev`, token `t`) or `RAILS_HOME=/tmp/x RAILS_TOKEN=t`. For `curl`, log in first with `POST /api/auth/login {"token":…}` and keep the cookie.
- Browser testing on this machine: use `agent-browser-remote` (see the global AGENTS.md). Start dev with `make dev-tmp` (or `make dev-lan`) and open `http://100.101.76.38:5173/?token=…`. The mac-mini reaches it over Tailscale.
- Live Claude tests run real agents with your Claude login. Use a scratch directory and delete the transcripts they leave in `~/.claude/projects/` afterwards.

## Invariants
- Provider transcripts are the source of truth. rails reads them and **never writes** them. The DB only stores projects and settings.
- The server owns live agent processes. Every WS client subscribed to a session sees the same events. A client disconnecting must never kill an agent.
- Message ids must be the same in the transcript and the live stream, because the client dedupes history against live messages by id. Claude uses `<entry uuid>:<blockIndex>`, and the SDK's `uuid` matches the transcript's (verified).
- Discovery must stay cheap. Provider stores can be huge (pi is about 600MB here), so scans read only the head and tail of each file and cache by mtime and size. Never read whole files during a scan.
- The web client must work over plain HTTP on the LAN or Tailscale, so don't use secure-context-only browser APIs (for example `crypto.randomUUID`). Use `randomId()` from `web/src/util.ts`.
- Keep server logic in plain service functions, not inside Hono route handlers. Routes should only parse input and call services, so the future home agent can reuse those services as tools.
- Project paths are stored as realpaths, because agents record the real cwd (on macOS, `/tmp` is really `/private/tmp`).

## Gotchas
- Live sessions exist only in server memory. Restarting the server stops them all, and `tsx watch` restarts it on every server file save. The transcripts survive, so the user can resume.
- Imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`). The server runs TypeScript directly through `tsx` and has no build step.
- Native `<select>` can't show images, so the agent picker shows text.
- Only `claude` can run live today. pi and Codex are discovery plus read-only transcripts. Codex parsing is written from public docs and hasn't been tested on this machine.

## Keeping docs current
Update the docs in the same change as the code:
- Provider capability changes go in the matrix in `architecture.md` and the status list in `README.md`.
- Format discoveries go in `providers.md`.
- New terms go in `CONTEXT.md`.
- New or changed foundations get a new numbered ADR. Never quietly break an existing one.
- Remove finished items from `roadmap.md`.
- Keep this file short: a map and rules. Detail belongs in `docs/`.
