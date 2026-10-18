# ADR 0002: Scope is three coding agents

Status: accepted

Rails supports exactly three providers: **Claude Code** (`claude`), **Codex** (`codex`) and **pi** (`pi`).

The goal is to give these three the deepest chat support possible: live sessions, resume, tool approvals,
and rich message rendering. Adding a fourth provider, or building a generic plugin system for providers,
is out of scope until this decision is revisited.

Consequences:
- `ProviderId` stays a closed union. Exhaustive `Record<ProviderId, …>` maps are fine.
- Provider-specific UI is welcome, for example official logos (`ProviderIcon`) and per-provider rendering of tool calls.
- The future rails-native home agent / harness (see roadmap) is a separate concern from this list.
