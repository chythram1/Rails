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

rails is a self-hosted web app for agentic software development. It works as an agent multiplexer:
you attach project directories, it discovers existing Claude Code / Codex / pi sessions, and you can
chat with those agents live from any device. "rails" is just the name. This is **not** Ruby on Rails.

## Read first
- `docs/CONTEXT.md` is the domain glossary (Project, Provider, Session, Transcript, Adapter, Live session…). Use these terms. Add a new concept there before using it.
- `docs/architecture.md` covers the layout, runtime picture, provider support matrix, and env vars.
- `docs/adr/` records decisions. Add a new numbered ADR when you change a foundation instead of silently diverging.
- `docs/providers.md` has transcript format notes. Update it when you learn something new about a provider format.
- `docs/roadmap.md` lists non-binding ideas (Customize, Automate, custom harness…).
- `docs/` is the general store for project knowledge. Put notes there, not in code comments or chat.

## Layout
- `packages/shared`: wire and domain types only (no runtime deps). Change the protocol here first.
- `packages/server`: Node + Hono + `ws`, `node:sqlite`, and provider adapters (`src/providers/*`). Live agents are in `src/live/*`.
- `packages/web`: React + Vite SPA. Plain CSS with tokens in `src/styles.css`, icons from `lucide-react`, hash routing.

## Commands
- `npm install`, then `npm run dev` (server :4317 + Vite :5173, open the printed `?token=` URL)
- `npm run typecheck` (must pass), `npm run build && npm start` (prod: server serves `web/dist`)
- Use `RAILS_HOME=/tmp/x` for throwaway state when testing. `RAILS_HOST=0.0.0.0` exposes it on the LAN or Tailscale.

## Invariants
- Provider transcripts are the source of truth. rails reads them and **never writes** them. The DB only stores projects and settings.
- The server owns live agent processes. Every WS client subscribed to a session sees the same events. Disconnecting must never kill an agent.
- Message ids must be stable across the transcript and the live stream. The client dedupes history and live messages by id (Claude: `uuid:blockIndex`).
- Provider stores can be huge (pi is about 600MB here). Discovery reads only the head and tail of each file, cached by mtime and size. Never read whole files during a scan.
- The web client must work over plain HTTP on the LAN, so no secure-context-only APIs (for example `crypto.randomUUID`). Use `randomId()` from `src/util.ts`.
- Keep server logic in plain service functions (`db.ts`, `git.ts`, `providers/*`, `LiveHub`), not inline in Hono route handlers. Routes should only parse input and call services, so the future home agent can reuse those services as tools (see `docs/roadmap.md`).
- Scope is exactly three coding agents: Claude Code, Codex and pi. Spend effort on deeper chat support for these three, not on adding providers.
- Only `claude` is live-capable today (`LIVE_PROVIDERS`). pi and codex are discovery and read-only.
- Test UI with `agent-browser-remote` (see the global AGENTS.md). Run dev with `RAILS_HOST=0.0.0.0` so the mac-mini can reach it over Tailscale.
