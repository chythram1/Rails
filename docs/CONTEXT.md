# Domain glossary

The shared vocabulary for rails. Use these terms in code, UI copy, and docs. If you introduce a new
domain concept, add it here first.

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| **Project** | A local directory attached to rails by absolute path. All sessions belong to exactly one project. Stored in our DB. Removing a project only *detaches* it: transcripts stay on disk, and attaching the same path again brings its sessions back. Removal is refused while the project has open panels. | A git repository. A project _may_ be a git repo, but doesn't have to be. |
| **Provider** | A coding-agent product rails can read and/or drive: `claude` (Claude Code), `codex` (OpenAI Codex CLI), `pi`. Identified by a `ProviderId`. | The LLM vendor or model. Pi can talk to Anthropic models, but its provider here is still `pi`. |
| **Session** | One agent conversation, identified by `(provider, providerSessionId)`. The provider's on-disk transcript is the source of truth for its history. The UI may call these "chats". | A browser connection or login session. |
| **Transcript** | The provider-owned file on disk that records a session (for example `~/.claude/projects/<enc>/<id>.jsonl`). rails reads transcripts and never writes them. | Our own DB rows, which are only an index. |
| **Discovery** | Scanning provider transcript stores to find sessions whose `cwd` is inside a project's directory. This is read-only. | Attaching a project, which is always an explicit user action. |
| **Adapter** | The server-side discovery code for one provider (`providers/<id>.ts`: `scan`). It finds sessions and their titles. Running an agent is not an adapter's job; panels run the provider's own CLI. | — |
| **Workspace** | A project's arrangement of panels: split panes with tabs. One per project; the layout is saved on the server so every device opens the same arrangement. | The rails app as a whole. |
| **Panel** | One terminal tab in a workspace, running a provider's native TUI (`claude`, `codex`, `pi`) or a plain `shell` in the project folder. Its process runs in its own tmux session, so it survives browser disconnects and server restarts, and every connected client sees and types into the same terminal. Closing a panel stops its process, and a panel closes itself when its process exits (`exit`, `/exit`, a crash). | A session. A panel may show a session (agents) or none (shells). |
| **Busy** | A panel whose program keeps printing output, as an agent does while it thinks or replies. The sidebar shows its session's dot yellow instead of green. | A panel that is merely open (green). |
| **Sprocket** | One of the user's always-on agents (ADR 0005): a shape (one of 8), a colour, one accessory or none, a name, and a chat. Stage 1 is only its look and chat UI; it doesn't run or reply yet. | A provider or a panel. |
| **Look** | What a Sprocket looks like: its shape (`character` in code), colour and accessory. | |
| **Resume** | Opening an existing session in a panel with the provider's own command: `claude --resume <id>`, `pi --session <id>`, `codex resume <id>`. Opening a session that already has a panel focuses that panel instead. | — |
| **Client** | A browser tab or device connected to the server over WebSocket. There can be many at once, each attached to panels as its own tmux client. | A user. v1 has exactly one user. |
| **Access token** | A shared secret that gates the whole server. v1 is single-user. | — |
| **Automation** _(future)_ | A saved prompt plus project plus schedule or trigger that starts sessions without a human. | — |
| **Harness** _(future)_ | rails' own agent loop, as opposed to driving a third-party provider. | — |
| **Home agent** _(future)_ | A single always-on agent native to rails that works across all projects from `~`. It can read projects and message sessions. It cannot start sessions. Its messages are labeled as coming from it. | A session. Claude Code, pi and Codex sessions inherit from their providers, but the home agent belongs to rails itself. |
