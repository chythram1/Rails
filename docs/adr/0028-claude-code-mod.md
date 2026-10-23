# ADR 0028: A Claude Code mod answers its questions from Rails

Status: accepted. It extends ADR 0027 to Claude Code, and adds a flag to ADR 0007's wiring.

ADR 0027 let the user send the Coordinator's answer to pi's and Codex's questions from the chat. Claude Code's
question dialog (AskUserQuestion) stayed the panel's: its hooks can answer the tool only before the dialog shows,
so waiting there for Rails would hide the question from the user. Claude Code 2.1.287 added mods: JavaScript
hooks a plugin runs inside Claude Code, loaded for one session with `--plugin-dir`, a command-line flag.

Decisions:
- **Rails ships a mod** (`packages/server/src/bridge/claude/mod`: `plugin.json`, `hooks/hooks.json`,
  `hooks/register.js`). At startup Rails copies it into `RAILS_HOME/claude-mod` (Claude Code writes type files into
  a mod's folder) and checks `claude --version`; with 2.1.287 or later, Claude Code panels start with
  `--plugin-dir` pointing at the copy. Nothing is installed, and the user's settings aren't touched (ADR 0007).
- **What it does:** a `tool.call` hook on AskUserQuestion with a single question reports the dialog to Rails
  (`POST /bridge/<panel>/claude/dialog`, by the tool call's `tool_use_id`, with the question and options), then
  races the dialog (`next(e)`) against Rails: it long-polls `GET /bridge/<panel>/claude/inbox` while the dialog is
  open and says whether it took an answer (`POST …/claude/delivered`). An answer from Rails returns the tool's
  result in the dialog's place, `{questions, answers: {[question]: text}}`, which closes the dialog and reaches
  Claude as the user's answer; the user's own answer in the panel wins if it comes first, and a late one from
  Rails is refused. Its panel and env (`RAILS_BRIDGE`, `RAILS_PANEL_TOKEN`) are the ones panels already have.
- **The server** treats it like ADR 0027's dialogs (`kind: "claude"`): the answer is the option's label when the
  draft names one, else the text (Claude's dialog takes typed answers), sent through a second inbox like pi's.
  Questions with several parts, and a Claude Code without mods, are answered in the panel.

Verified live with 2.1.309: Rails' answer closed the dialog ("User answered Claude's questions: … → No"); the
panel's answer after a wait stood, and the draft expired; a typed answer not among the options was taken; a hook's
waits on `next` and on `$.http.fetch` don't count against its time limit (the budget stayed at 10 s).

Consequences:
- The mods API is new and "can change between releases"; the mod only uses `tool.call`, `next`, `$.env`,
  `$.http.fetch` and `$.clock.sleep`. If it breaks, Claude Code skips the hook and the dialog works as before.
- Organisation policies (managed settings, a web-fetch policy) may block the mod's requests; the panel still works.
- The mod is also where later Claude Code integrations belong (they replace hooks only where hooks can't do it).
