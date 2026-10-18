# Provider transcript formats

These are notes from inspecting real files on disk. Every format here is JSONL with one event per line.
Formats change between provider versions, so parsers should skip unknown lines. Since ADR 0003 Rails
only reads transcripts for discovery (cwd, title, dates); the agents' TUIs render the conversation.

## Claude Code — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

- `<encoded-cwd>` is the cwd with `/` and `.` replaced by `-`. This is lossy, so read the real `cwd`
  from the line entries instead of decoding the directory name.
- Relevant line `type`s:
  - `user`: `message: {role:'user', content: string | Block[]}`. Tool results come back as `user` lines with `tool_result` blocks.
  - `assistant`: `message: {content: Block[]}`, where blocks are `text`, `thinking`, or `tool_use {id,name,input}`. One API message can be split across several lines that share the same `message.id`.
  - `custom-title {customTitle}` and `summary {summary}` hold the session title.
  - Also seen (ignored): `attachment`, `queue-operation`, `file-history-snapshot`, `system`, `last-prompt`, `agent-name`, `cost-state`, `mode`, `permission-mode`.
- Common fields: `uuid`, `parentUuid`, `timestamp`, `cwd`, `sessionId`, `gitBranch`, `isSidechain`. Skip lines with `isSidechain: true`, which are subagent traffic.
- For titles, lines with `isMeta: true` and user text starting with `<command-`, `<local-command` or `<system-reminder` are harness noise and get skipped.
- `claude --resume` appends `mode`, `permission-mode` and `cost-state` lines on start, even without a
  message, so the transcript's mtime (and its "last active" in Rails) changes just from reopening it.
- CLI (verified): `claude --session-id <uuid> [-- prompt]` starts a session with a known id; `claude --resume <id>` reopens one. The first run in a new folder shows Claude's folder-trust prompt.
- Hooks (verified with 2.1.302, used by the bridge, ADR 0007): `--settings <json>` adds hooks without touching the user's settings. `type:"http"` hooks POST the hook input as JSON (`headers` can use env vars listed in `allowedEnvVars`), except SessionStart, where only `type:"command"` hooks fire. Inputs carry `session_id`, `cwd`, `transcript_path`; PostToolUse has `tool_name`, `tool_input` (Write/Edit: absolute `file_path`), `tool_response`; Stop has `last_assistant_message`. PermissionRequest fires as soon as a permission dialog shows; the Notification hook's `idle_prompt` fires after every finished turn left alone for a minute, so it isn't a "needs you" signal.
- Each session binds a message socket (`$CLAUDE_CODE_MESSAGING_SOCKET`, e.g. `/tmp/cc-socks/<pid>.sock`); a line `{"type":"user","message":{"role":"user","content":…}}` written to it reaches the session (undocumented, used from step 3).

## pi — `~/.pi/agent/sessions/--<cwd with / → ->--/<iso>_<sessionId>.jsonl`

- The first line is `{type:'session', version:3, id, timestamp, cwd}`.
- `message` lines contain `message.role`, which is one of:
  - `user`: `content: [{type:'text', text}]`
  - `assistant`: `content: [{type:'text'|'thinking'|'toolCall', ...}]`. `toolCall` has `{id, name, arguments}`.
  - `toolResult`: `{toolCallId, toolName, content:[{type:'text',text}], isError}`
  - `system`: ignored
- Other lines (ignored for now): `model_change`, `thinking_level_change`, `usage`, `custom`, `custom_message`.
- Title: the scanner reads `session_info.name` if it exists, otherwise the first user message. **Unverified**:
  no local transcript contains a `session_info` line yet, so check pi's source before relying on it.
- User text can begin with a `<skill name="…">…</skill>` wrapper. Titles render it as `/<skill> rest`.
- Entries form a tree through `id` / `parentId`. v1 renders them in file order.
- CLI (verified): `pi --session-id <uuid> [-- prompt]` creates a session with that id; `pi --session <id>` reopens one. pi warns when tmux `extended-keys` is off, so Rails turns it on.
- Extensions (verified with 1.3): `--extension <file.ts>` loads one for a run (pi lists it by file name). Events used by the Rails extension: `session_start` (`ctx.sessionManager.getSessionId()/getCwd()`), `before_agent_start` (`messageType`, `prompt`), `tool_call` (`toolName`, `input`, paths relative to cwd), `ui_prompt_start/end` (approval dialogs from other extensions), `agent_end` (`messages`), `session_shutdown`.

## Codex CLI — `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`

Checked with Codex 0.163.0 (October 2026): the rollout path below is right, and the folder only appears once
the first thread exists. The line format still comes from the public docs and is **untested**.

- The first line is `{type:'session_meta', payload:{id, cwd, timestamp, ...}}`.
- `{type:'response_item', payload:{type:'message', role, content:[{type:'input_text'|'output_text', text}]}}`
- `{type:'response_item', payload:{type:'function_call', name, arguments, call_id}}` and `function_call_output`.
- CLI: `codex [-- prompt]` starts a session (id unknown until its rollout file appears); `codex resume <id>` reopens one,
  but fails ("no rollout found") for a thread that has no turns yet. `codex delete --force <id>` deletes a thread.
- Codex 0.16x also keeps thread metadata in `~/.codex/state_<n>.sqlite` (`threads`: id, cwd, title, rollout_path, …)
  and runs interactive sessions on a shared local **app-server daemon** (`codex app-server daemon version` prints
  its socket). Clients speak JSON-RPC over a WebSocket on that Unix socket: `thread/list` filters by `cwd`, and
  thread events are broadcast to clients. Any `-c`, `--enable`, `--disable` or `--search` flag makes the TUI run
  embedded instead, so its thread is invisible to the daemon.
- Daemon details (verified with 0.163): every client gets `thread/started` (thread `id`, `cwd`, `createdAt`, `ephemeral`) and `thread/status/changed` (`activeFlags`: `waitingOnApproval`, `waitingOnUserInput`). `thread/resume {threadId, excludeTurns:true}` subscribes to turns and items (`item/completed`: `userMessage`, `commandExecution`, `fileChange`; `turn/completed` with the final `agentMessage`), but fails ("no rollout found") until a new thread has saved its first turn. The TUI also starts short-lived helper threads; skip `ephemeral` ones.
