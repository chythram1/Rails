# ADR 0030: Codex gets the agent tools as dynamic tools

Status: accepted. It settles ADR 0018's open question for Codex, which had no agent tools.

Codex was the one agent with no `neighbours`, `message` or `wait_for` (ADR 0018). The ways ADR 0018 knew of
were all closed: the user's config file, a `-c` flag (Codex then runs without the daemon Rails follows), or
overrides when Rails rejoins a running thread. Without `message`, Codex leaves follow-ups for other sessions in
its replies: test runs 4, 9 and 10 lost or delayed them until findings routing (ADR 0029) or the Coordinator
caught them.

Codex's app-server has dynamic tools, behind its experimental API: tools a client gives a thread when it starts
it (`thread/start` with `dynamicTools`), which the model calls like its own and the daemon sends to the thread's
clients as `item/tool/call` requests. Checked with Codex 0.163, against its source (`rust-v0.163.0`) and live:
- The daemon sends a call to every client subscribed to the thread. The TUI answers only calls in its own
  namespace (`codex_tui`) and leaves the others alone, so Rails answers calls in `rails`.
- Codex saves the tools with the thread (`dynamic_tools` in the rollout's `session_meta`). They're there after
  `codex resume` and after `/fork`, but only a thread's start can set them: `thread/resume` has no `dynamicTools`.
- There's no timeout on a call: an answer after 110 s worked. A call made while Rails is disconnected waits, and
  the daemon sends it again to Rails when it subscribes. If the user interrupts, the only signal is
  `turn/completed` with status `interrupted`.

Decisions:
- **Rails starts a new Codex panel's thread** on the daemon, with the three tools in one `rails` namespace (the
  namespace's description holds the instructions MCP agents get), and the panel runs `codex resume <id>
  [-- prompt]`. There are still no `-c` flags. Rails starts the daemon if it isn't running (`codex app-server
  daemon start`, which the first `codex` would otherwise do). The panel knows its thread from the start, so new
  panels no longer depend on matching a thread by folder (ADR 0007).
- **The thread is saved before the TUI opens it.** The TUI can't resume a thread with nothing saved ("no
  rollout found"), and Codex saves a thread at its first turn, or when it's moved between the sidebar's sections.
  Rails moves it to no section (`thread/section/move {sectionId: null}`), where it already is, so Codex saves it
  with no other effect. Rails' sidebar hides a Codex session that has only its `session_meta` line, which is
  what a panel closed before its first prompt leaves.
- **Only in a folder Codex trusts.** A thread keeps the permissions it started with, and in a folder Codex
  doesn't trust yet they're read-only. The TUI asks for trust before starting its own thread, but it can't change
  one that already exists (seen live: "this read-only workspace" after trusting). The daemon unloads a thread
  only 30 minutes after its last client leaves, so Rails can't hand it over to be reloaded with the new
  permissions either. Rails asks the daemon (`config/read` with the folder) and starts the thread only if the
  folder, its git root or its main repository is trusted. Otherwise, and whenever Codex doesn't manage within
  10 s, the panel runs plain `codex` as before: it asks for trust, gets no tools, and is matched to its thread by
  folder. The next Codex panel in that folder gets the tools.
- **Calls are answered like MCP's** (`callTool` in `agentTools.ts`, shared with the MCP server). An answer is
  kept for 10 minutes by Codex's call id, so a call sent again after Rails reconnects isn't run twice; a call
  whose turn ends (interrupted) is aborted, which stops a `wait_for`.
- **Rails ignores its own new threads** when it matches threads to panels started with plain `codex`. The daemon
  can announce a thread before it answers `thread/start`, so threads that start in a folder while Rails is
  starting one there wait until Rails knows which one is its own.

Limits:
- Codex sessions started before this change (or with plain `codex`), and threads from `/new`, have no tools:
  only a thread's start can add them.
- It rests on two experimental APIs (`dynamicTools`, `thread/section/move` to save a thread) that may change
  between Codex releases. Each failure falls back to plain `codex`.
- A new Codex panel in a folder Codex doesn't trust yet gets no tools. The test-run harness trusts the project
  before it opens panels (and removes the entry afterwards).

Considered:
- **Per-thread `config` overrides with Rails' MCP server** (`thread/start` takes `config`). That would reuse the
  MCP endpoint, but the overrides aren't saved with the thread, so a resumed session would lose the tools.
- **Waiting for the TUI's first turn before adding tools.** Tools can only be set at a thread's start.
- **Unloading the thread so the TUI reloads it with its permissions.** The daemon keeps it loaded for 30 minutes
  (`thread_unload_delay_secs`), and a resume may keep the thread's saved permission profile anyway (Codex's
  config code reads it back; not checked live).
