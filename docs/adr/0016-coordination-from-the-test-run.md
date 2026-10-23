# ADR 0016: One Sprocket per project, owners, and edits made by shell commands

Status: accepted (changes ADR 0009's Coordinator switch; builds on ADR 0014 and 0015).

A test run (three coding agents on cheap models, building a browser game in about 1.5 hours, with a Coordinator and
a second, read-only Sprocket) showed what coordination needs and what it doesn't:
- The second Sprocket did nothing the Coordinator couldn't: its answers depended on how it was asked, not on being
  a separate Sprocket, while the Coordinator switch, its handover and "which one do I ask?" cost code and attention.
- The Coordinator sent two of four playtest findings to the wrong session: it didn't know who owned what.
- One agent wrote every file through shell commands (`cat > f <<EOF`, Python scripts), so overlap warnings never
  saw its edits.

Decisions:
- **One Sprocket per project, and it's the Coordinator.** Attaching a Sprocket makes it its project's Coordinator;
  a project that has one is taken ("Lead already looks after app. Detach it first."), and the settings list shows
  it as such. The Coordinator switch and its handover go. Unattached Sprockets stay, to chat with. A database index
  keeps it to one; where a project had several, its Coordinator (or the oldest) keeps it and the others are
  detached with their chats kept.
- **Owners.** The user tells the Coordinator who owns what ("Claude owns src/engine and index.html"); it records it
  with `set_owner` (files or folders relative to the project, at most 10 per session, no path owned twice). Owners
  are in its instructions, so it routes requests by them, and listed on its job page, each removable. An edit to
  files another live session owns wakes the Coordinator like an overlap (ADR 0014), marked "owned by", whether or
  not the owner changed them lately; the most specific owned path wins. Owners go when their panel closes. The
  event says which owned files the changing session's own prompts never named: those it wasn't asked to change
  (test run 10: Codex wired its scheduler into Claude's `src/main.js` and `src/app/`), and the Coordinator drafts
  it a heads-up to move its change into its own files, unless the brief makes them shared. Files its prompts
  named were asked for, so a session told to "add a field in src/game/state.js" isn't flagged.
- **Edits made by shell commands count.** When a session runs a shell command (Claude Code's Bash, through a
  PreToolUse hook now matching it too; pi's bash, whose end the extension now reports; Codex's command items), Rails
  notes the project's changed files with `git status` and each file's modification time and size, at the start and
  again at the end, and counts as that session's edits the files that changed in between or were modified after it
  started. Files another session reported changing with its edit tools meanwhile stay theirs (looked up 1.5 s after
  the command ends, since those reports can arrive late); commands longer than 60 s are left out, since they'd
  collect everyone's edits; projects that aren't git repositories are skipped. A command whose line only reads
  (`cat`, `rg`, `sed -n`, `git diff`, `node --test`… with no redirection to a file) counts nothing: in test run 6 a
  Codex that was only reading `src/main.js` took the blame for Claude Code's edit to it. Anything Rails can't read
  that way (a heredoc, a script, quoting it can't follow) still counts.
- **Smaller fixes from the run:** a Sprocket's usage (runs, tokens, and cost where the provider reports one) is
  recorded per run, quiet ones included, and shown in its settings; a message Rails put in pi's queue that pi hands
  back to its editor when the user presses Escape is marked not sent, saying where it is.

Consequences:
- Two sessions writing files in the same seconds can blur who changed what; a long-running shell command's edits go
  unseen. Both trade a little accuracy for not reading every agent's commands.
- Claude Code now calls Rails before every shell command too. That hook waits at most 1 s, and a stopped Rails
  refuses at once (three commands ran in a 7 s turn with Rails down), but Claude Code then shows a
  "PreToolUse:Bash hook error" line beside the existing PostToolUse one.
- One Sprocket per project limits a project to one standing set of instructions. A Sprocket with a different job
  (a scheduled digest, say) would need this revisited.
