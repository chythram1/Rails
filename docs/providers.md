# Provider transcript formats

These are notes from inspecting real files on disk. Every format here is JSONL with one event per line.
Formats change between provider versions, so parsers should skip unknown lines.

## Claude Code — `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`

- `<encoded-cwd>` is the cwd with `/` and `.` replaced by `-`. This is lossy, so read the real `cwd`
  from the line entries instead of decoding the directory name.
- Relevant line `type`s:
  - `user`: `message: {role:'user', content: string | Block[]}`. Tool results come back as `user` lines with `tool_result` blocks.
  - `assistant`: `message: {content: Block[]}`, where blocks are `text`, `thinking`, or `tool_use {id,name,input}`. One API message can be split across several lines that share the same `message.id`.
  - `custom-title {customTitle}` and `summary {summary}` hold the session title.
  - Also seen (ignored): `attachment`, `queue-operation`, `file-history-snapshot`, `system`, `last-prompt`, `agent-name`, `cost-state`, `mode`, `permission-mode`.
- Common fields: `uuid`, `parentUuid`, `timestamp`, `cwd`, `sessionId`, `gitBranch`, `isSidechain`. Skip lines with `isSidechain: true`, which are subagent traffic.
- Lines with `isMeta: true` and user text starting with `<command-`, `<local-command` or `<system-reminder` are harness noise and get skipped.
- Live: the Agent SDK streams the same `user` / `assistant` shapes, and their `uuid` matches the transcript entry (verified), so one normalizer (`normalizeClaude`) handles both.
- Resume: `query({ prompt, options: { resume: sessionId, cwd } })`. New: `options.sessionId = <uuid>` so rails knows the id up front.

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
- Live (planned): `pi --mode rpc --session <id>`.

## Codex CLI — `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`

Codex isn't installed on the dev machine, so these notes come from the public format and are **untested**.

- The first line is `{type:'session_meta', payload:{id, cwd, timestamp, ...}}`.
- `{type:'response_item', payload:{type:'message', role, content:[{type:'input_text'|'output_text', text}]}}`
- `{type:'response_item', payload:{type:'function_call', name, arguments, call_id}}` and `function_call_output`.
- Live (planned): `codex app-server` (JSON-RPC over stdio) or `codex exec --json resume <id>`.
