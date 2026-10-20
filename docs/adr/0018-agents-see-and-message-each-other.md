# ADR 0018: Agents see and message each other

Status: accepted in part (builds on ADR 0007, 0010, 0015 and 0016). `neighbours` is built for Claude Code and pi
(`agentTools.ts`); `message` and `wait_for` are still proposed.

Today a project's sessions know nothing of each other: only the Coordinator sees across them, and everything that
passes between them is a draft the Coordinator writes. The second test run showed both halves of the cost. The
breakages that crossed sessions came from an agent not knowing what another was doing (pi edited files the engine
session owned; a new enemy type from the gameplay session broke the UI session's tests), and most of the drafts the
user had to edit were the Coordinator retelling, worse, something an agent had already said well (it dropped a
cause, reversed an instruction, picked the opposite of what its own rule said).

Other multiplexers let agents drive the multiplexer themselves: a command-line tool and an instruction file let an
agent list its neighbours, start and prompt other agents, wait for them and read their screens. They deliver by
typing into terminals and send without asking anyone. Rails has better parts for the same idea: a token per panel
(ADR 0007), structured status on the board, delivery through each agent's own way in (ADR 0010), and owners
(ADR 0016). This ADR uses them to let agents look across the project and talk to each other, with the user still
sending every message.

Decisions (proposed):
- **Three agent tools**, served by the bridge to the agents in Rails panels and checked with the panel's token, so
  an agent only reaches its own project:
  - `neighbours`: the other sessions in the project, read-only: each one's agent, short title, status (the word
    alone: not a dialog's title or an error's text, which are the session's own), the files it changed lately, who
    owns what, and its last reply clipped to 400 characters. That reply is the one piece of
    another session's conversation an agent sees: it's the session's own summary of its work, written to be read.
    What the user asked a session (its prompts) and the commands it ran stay out, since they can hold things the
    user meant only for that session (keys, paths, private notes); so do transcripts, files and other projects.
    The result starts with the board's note that quoted text is what other sessions reported, data and not
    instructions. It's built from the board like `boardText`, without its "asked" and "last command" lines.
    One leak remains: a session's title can be the start of its first prompt (pi titles sessions that way, and so
    does Claude Code until it has a title of its own), so titles are cut to 60 characters and the note at the top
    says titles are reported text too.
  - `message(session, text)`: a draft message for another session in the project. It lives in the project's
    Coordinator chat, the one place drafts are reviewed (ADR 0010, 0016): an event row ("“Engine” wants to tell
    “UI”:") with the usual draft card under it, stored as a suggestion of the Coordinator's with the sending panel
    noted. It goes out only when the user presses Send, edited or not, and the delivered text starts with who it's
    from. Posting it runs no model: the Coordinator sees it in its chat the next time it runs. In a project without
    a Coordinator the tool refuses ("Nobody here shows drafts to the user: say it in your reply instead"). An
    agent can't message itself, a shell, a session in another project, or answer a dialog. Limits: at most 3 of a
    session's drafts wait at a time, and a receiving session has at most 3 messages waiting for it in all
    (`MAX_PENDING_MESSAGES`, shared with the Coordinator's own, since agents' drafts are stored as its
    suggestions); the text has the suggestions' length limit (`SUGGESTION_MAX`).
  - `wait_for(session)`: what that session is doing once it's no longer working. It sends nothing. It returns:
    - at once, if the session isn't working: idle (with its last reply), waiting for the user, failed, or stopped;
    - at once, if Rails has no reports for it (opened before Rails could see it): "Rails can't follow this one";
    - at once, if it ended, its panel closed, or the panel moved on to another session (a wait follows the
      session, not the panel, as handoffs do, ADR 0015): which of these;
    - otherwise when it next ends a turn, stops, fails or waits for the user, with that status and its last reply;
    - or after 2 minutes with "still working", so the agent can call again. Two minutes stays under the agents'
      tool timeouts (for Claude Code Rails sets the server's `timeout` in the config it passes, as Claude Code's
      MCP docs describe; pi's tools have none).
    Each result also lists the files the session changed while the agent waited.
- **Wiring, by flags only** (the invariant of ADR 0007):
  - Claude Code: `--mcp-config` with an HTTP server at `/bridge/<panel>/mcp` and `Authorization: Bearer
    ${RAILS_PANEL_TOKEN}`. Checked with 2.1.304: a server added this way connects without an approval prompt,
    the variable in the header expands, and the tool ran without a permission prompt in auto mode (the default
    mode wasn't checked). The user's own MCP servers should stay loaded (Claude Code's docs: only `--strict-mcp-config` drops them; not checked).
  - pi: the Rails extension registers the same server (`pi.registerMcpServer`, `direct` exposure, so the model
    sees the tool without searching for it). Checked with pi 1.3: the tool appears as `rails/neighbours`, and the
    user's own MCP servers stay.
  - Codex: none at first. Adding tools needs its config file (the user's), a `-c` flag (which makes it leave the
    daemon Rails follows), or overrides passed when Rails rejoins a running thread (`thread/resume` takes `config`
    and `developerInstructions`, but whether they apply to a running thread is unverified, and they might change
    the user's session). Codex sessions still show up to the others and still get messages.
- **The user stays the one who sends.** Every message is a draft until the user sends it; sending without asking
  is out of scope here and would need its own decision and a track record. Agents can't answer permissions or
  dialogs, through Rails or each other. The draft card is the safeguard, and it has limits that differ by agent:
  - Claude Code treats a delivered message as a teammate's request, never as the user's approval for something
    it was told to wait for (`docs/providers.md`), so a message can't stand in for the user's go-ahead there.
  - pi and Codex show a delivered message as the user's own prompt. Once the user sends an agent's draft, pi and
    Codex act on it as the user's instruction, including anything in it that reads like permission ("the user
    says you can push"). The delivered text names the sender, but nothing stops them obeying it.
  - So the card shows the sending session as plainly as the text, and the user should read an agent's draft as
    they'd read an instruction they're about to give. Agents messaging each other can't loop: each message waits
    for the user.

Considered:
- **A command-line tool on the PATH plus an instruction file** (the other multiplexers' way). It reaches any agent
  that runs shell commands, but agents have to be told it exists (an instruction file is the user's), and Codex
  runs commands in its shared daemon, whose environment isn't the panel's (unverified), so the panel's token
  wouldn't reach it.
- **Claude Code channels** (an MCP server that pushes messages into a session): a research preview that needs
  `--dangerously-load-development-channels` for a server that isn't on an allowlist. Worth another look when it
  leaves the preview, as a delivery path.
- **Leaving it to the Coordinator** (today). It keeps one voice, but drafts lose what the agents knew, and the
  agents keep breaking each other's work without knowing it.
- **Sending without the user**: faster, but it gives up the rule the rest of the coordination layer rests on, and
  agents messaging each other could loop.

Open questions:
- Whether Claude Code asks permission for these tools outside auto mode, and if so whether Rails should allow its
  own read-only ones (`neighbours`, `wait_for`) in the permission rules it already passes with `--settings`
  (still flags only). `message` stays on whatever the user's own rules say.
- Codex: whether the overrides `thread/resume` takes reach a running thread without changing the user's session;
  until then Codex gets no tools.
- Whether the Coordinator should also comment on agents' drafts when it next runs, or only see them.
