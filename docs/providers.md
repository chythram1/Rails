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
- Questions (verified with 2.1.302): AskUserQuestion's `tool_input` is `{questions:[{question, header, options:[{label, description}], multiSelect}]}`. A PreToolUse hook that returns `{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"allow", updatedInput:{...tool_input, answers:{"<question>":"<label>"}}}}` answers it without a dialog (shown as "User answered Claude's questions: … → Green"); it has to answer before the dialog shows, and while it runs the TUI only says "running PreToolUse hook". `deny` with a reason also reaches the model, but shows as a hook error. A message to the inbox socket while the dialog is open waits in the queue; it doesn't answer it. In the dialog, a digit picks that option and moves on (several questions end on a review screen, where `1` submits). The question tool also triggers a PermissionRequest hook (`tool_name: "AskUserQuestion"`) right after PreToolUse.
- Message socket (verified with 2.1.302, used for replies, ADR 0010): a JSON line `{"type":"user","message":{"role":"user","content":…}}` written to `CLAUDE_CODE_MESSAGING_SOCKET` (no auth line needed on macOS) starts a turn on an idle session. Claude Code wraps it as "Another Claude session sent a message: … This came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request …" (also in the transcript, after a `queue-operation` entry), so it acts on it but won't take it as approval for a pending prompt.
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
- Questions (verified with 1.3): pi has no question tool of its own; extensions add them. `@juicesharp/rpiv-ask-user-question`'s `ask_user_question` takes Claude's question shape; its `tool_call` comes first, then `ui_prompt_start {kind:"custom"}` (no title or options), `ui_prompt_end`, and the result text `User has answered your questions: "Q"="Green".` Its dialog ignores digits (arrows and Enter work). Another extension's `tool_call` handler returning `{block:true, reason}` skips the dialog, and the model reads the reason as the tool's result. Approval extensions (such as a "require approval" one) use `ctx.ui.confirm/select` too, so a `ui_prompt_start` alone can't tell a question from an approval. How Rails tells them apart (ADR 0009): its extension keeps the input of running tool calls that look like questions (a `questions` list or a `question` string; ids from `tool_call`, cleared on `tool_execution_end`) and sends the latest with `ui_prompt_start`; the server reads questions from it by shape (`questionsOf`: `{questions: [{question, options}]}` or `{question, options | choices}`, options as strings or `{label | value | title}`; none means an open question). A dialog with no such input (an approval during `write` or `bash`) stays unknown, and a question-shaped tool that opens no dialog (one that asks another model) is just a tool.
- Sending messages (verified with 1.3): an extension can call `pi.sendUserMessage(text)`; when pi is idle it starts a run (`before_agent_start` with `messageType: "user"`), shown in the TUI as the user's prompt. While it's streaming, pass `deliverAs: "followUp"` (or `"steer"`); `ctx.isIdle()` says which.

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
- Daemon details (verified with 0.163): every client gets `thread/started` (thread `id`, `cwd`, `createdAt`, `ephemeral`) and `thread/status/changed` (`activeFlags`: `waitingOnApproval`, `waitingOnUserInput`). `thread/resume {threadId, excludeTurns:true}` subscribes to turns and items (`item/completed`: `userMessage`, `commandExecution`, `fileChange`; `turn/completed` with the final `agentMessage`), but fails ("no rollout found") until a new thread has saved its first turn. The TUI also starts short-lived helper threads; skip `ephemeral` ones. Replies (ADR 0010, from the generated protocol schema, not yet run live here): `thread/queue/add {threadId, clientUserMessageId, input:[{type:"text", text}]}` starts a turn on an idle thread, shown as the user's message.
