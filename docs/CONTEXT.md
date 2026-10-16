# Domain glossary

The shared vocabulary for rails. Use these terms in code, UI copy, and docs. If you introduce a new
domain concept, add it here first.

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| **Project** | A local directory attached to rails by absolute path. All sessions belong to exactly one project. Stored in our DB. Removing a project only *detaches* it: transcripts stay on disk, and attaching the same path again brings its sessions back. Removal is refused while the project has live sessions. | A git repository. A project _may_ be a git repo, but doesn't have to be. |
| **Provider** | A coding-agent product rails can read and/or drive: `claude` (Claude Code), `codex` (OpenAI Codex CLI), `pi`. Identified by a `ProviderId`. | The LLM vendor or model. Pi can talk to Anthropic models, but its provider here is still `pi`. |
| **Session** | One agent conversation, identified by `(provider, providerSessionId)`. The provider's on-disk transcript is the source of truth for its history. The UI may call these "chats". | A browser connection or login session. |
| **Transcript** | The provider-owned file on disk that records a session (for example `~/.claude/projects/<enc>/<id>.jsonl`). rails reads transcripts and never writes them. | Our own DB rows, which are only an index. |
| **Discovery** | Scanning provider transcript stores to find sessions whose `cwd` is inside a project's directory. This is read-only. | Attaching a project, which is always an explicit user action. |
| **Adapter** | The server-side code for one provider. The *discovery adapter* (`providers/<id>.ts`: `scan`, `readTranscript`) exists for every provider. The *live adapter* (`live/<id>.ts`, today only `ClaudeLive`) starts and resumes sessions. | — |
| **Live session** | A session whose agent process is currently owned by the rails server. Survives browser disconnects, and every connected client sees the same event stream. It doesn't survive a server restart. | A session someone is running in their own terminal. rails does not mirror those live in v1. |
| **Resume** | Starting a live session from an existing transcript, using the provider's resume mechanism (for Claude, `resume: <sessionId>`). | — |
| **Message** | The normalized unit of a conversation shown in the UI: `user`, `assistant` text, `thinking`, `tool_use`, `tool_result`, `system`. Every adapter maps its native format to this. | Raw provider events. |
| **Permission request** | A live agent asking to run a tool. Shown as a card. Any connected client can allow or deny it, and the first answer wins. | — |
| **Permission mode** | Per-live-session policy: `default` (ask), `acceptEdits`, `bypassPermissions`, `plan`. These map to Claude's modes. | — |
| **Client** | A browser tab or device connected to the server over WebSocket. There can be many at once. | A user. v1 has exactly one user. |
| **Access token** | A shared secret that gates the whole server. v1 is single-user. | — |
| **Automation** _(future)_ | A saved prompt plus project plus schedule or trigger that starts sessions without a human. | — |
| **Harness** _(future)_ | rails' own agent loop, as opposed to driving a third-party provider. | — |
| **Home agent** _(future)_ | A single always-on agent native to rails that works across all projects from `~`. It can read projects and message sessions. It cannot start sessions. Its messages are labeled as coming from it. | A session. Claude Code, pi and Codex sessions inherit from their providers, but the home agent belongs to rails itself. |
