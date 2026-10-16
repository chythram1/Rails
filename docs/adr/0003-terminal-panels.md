# ADR 0003: Native agent TUIs in terminal panels

Status: accepted. Supersedes ADR 0001 items 2, 6 and 10, and the "live Claude chat" part of item 4.

rails is now an agent multiplexer in the literal sense. Each agent runs its own native terminal UI
(Claude Code, Codex, pi), and the web app shows those terminals as panels you can split, resize and
rearrange. The custom chat interface is gone. Reference: `ref/panels.png`.

Decisions:
1. **Replace the custom chat fully.** Opening a session starts the provider's CLI in a terminal:
   `claude --resume <id>`, `pi --session <id>`, `codex resume <id>`. Tool approvals, permission modes
   and message rendering happen inside each TUI. The Claude Agent SDK path, permission cards and
   transcript rendering are removed. Transcripts are still read for discovery (titles, sidebar).
2. **tmux backs every panel.** Each panel's process runs in its own tmux session on a socket private to
   the rails home (`$RAILS_HOME/tmux.sock`). The server attaches to it through node-pty, one tmux client
   per connected browser panel. So agents survive server restarts, every device sees the same terminal
   (tmux `window-size latest`), and you can attach from a normal terminal with
   `tmux -S ~/.rails/tmux.sock attach`. tmux is now a host requirement.
3. **Split panes with tabs** (dockview): drag dividers to resize, drag tabs to move or split.
4. **One workspace per project.** The layout is saved on the server (SQLite), so every device opens the
   same arrangement. Narrow screens show one panel at a time with a tab strip.
5. **Panel kinds:** `claude`, `codex`, `pi`, and a plain `shell` in the project folder.
6. **Closing a tab stops its process**, without a confirmation prompt (*amended*; it used to ask). Transcripts stay on
   disk, so the session can be resumed from the sidebar.
7. **Starting agents:** a sidebar session opens (or focuses) its panel; each pane's `+` starts a new
   agent or shell; the home composer starts the chosen agent with the prompt as its first message.

   *Amended:* a panel also closes itself when its process exits (`exit`, `/exit`, a crash); tmux runs with
   `remain-on-exit off`. Originally exited panels stayed on screen until closed by hand, which felt broken.

Consequences:
- A web terminal is remote shell access. Token auth and the localhost-by-default bind (ADR 0001 #5)
  matter more now.
- rails can no longer see message-level detail live (no "waiting for approval" dot). The sidebar only
  knows whether a session has an open panel.
- Codex is still untested on the dev machine.
