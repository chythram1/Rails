# ADR 0008: The Sprocket harness: codemode over capabilities

Status: accepted (Sprockets stage 2, before messaging sessions).

Sprockets had a hand-written tool for each thing they could do (the board, a session's activity and
conversation, git status, remember). Every new ability meant another tool, schema and prompt text, and a
question like "what are the busy sessions saying?" took the model one round trip per call. Messaging
sessions, watches and shared notes would multiply that.

Decisions:
- **One tool, codemode.** The model writes a JavaScript script that calls the Sprocket's capabilities as
  `tools.<name>(args)`; only the script's output reaches the model, so it can batch calls (`Promise.all`),
  loop over results and filter them first. It's modeled on pi's own codemode tool (pi-coding-agent's codemode
  extension): the same script format (raw JavaScript, an optional `// @options:` line), description (each
  capability with its TypeScript declaration), result format ("Script completed/failed", `==> text N/M <==`,
  a `<console_output>` block, the calls already made on failure) and `store()`/`load()`.
- **pi's sandbox**, `@earendil-works/pi-codemode` (MIT, no other pi dependencies): QuickJS compiled to
  WebAssembly, in a worker thread. Scripts have no Node, file system, network or timers; capabilities are
  their only way out.
- **Capabilities** (`harness/`) are plain server functions with a TypeBox schema, an optional output schema
  (structured results, else text) and an effect, `read` or `act`. Arguments are checked like pi checks a tool
  call (pi-ai's `validateToolArguments`). Every limit lives in these functions, never in the script: the
  Sprocket's project only, size caps, and at most 10 changes (`act` calls) per run, counted across its scripts.
- **What differs from pi**, because Sprockets run unattended inside the Rails server: a 60 s default deadline
  (120 s at most), a 128 MB heap, at most 2 scripts at once, no images or tool search, output trimmed instead of
  saved to a file, and the store kept per Sprocket and cleared when it moves to another project (like its chat).
- **The first capabilities** (attached Sprockets): `project_board`, `list_sessions`, `session_activity`,
  `session_conversation`, `git_status`, `git_diff`, `git_log`, `git_show`, `read_file`, `search_files`; every
  Sprocket has `remember`. Files are read-only, inside the project's realpath only (links resolved first), and
  files git ignores or that usually hold secrets (`.env`, keys, `.npmrc`, `credentials.json`, `.ssh`, `.aws`,
  `.git`) are refused. One policy (`isSecretPath` in `files.ts`) covers reads, folder listings, searches and git
  patches, whose sections for such files are left out. Large outputs are bounded while they're read: git is
  stopped after 512 KB, a listing looks at 1,000 entries at most. Search uses ripgrep when it's installed,
  else `git grep`.

- **Runs see their recent tool work.** Each reply saves the run's tool calls and results (results trimmed to
  6,000 characters, never sent to browsers), and later runs get them back for the 3 most recent such replies.
  Without them a model sees its earlier answers with nothing behind them, and doubts or redoes its own work.
- **A run log.** Each capability says, in a few words, what a call is doing ("Reading src/api.ts") and what
  a run's calls of it did ("read 2 conversations"). Browsers get the step and the summary so far as
  `sprockets.activity`; the summary is saved with the reply, and the chat shows it above the reply.

Consequences:
- A new ability is one capability: no tool or prompt plumbing, and the model sees it in the codemode
  description. The same functions can later serve agents in panels (MCP, the pi extension).
- Codemode needs a model that writes decent JavaScript; users bring their own models. If cheap models fail
  too often, plain tools can be generated from the same capabilities.
- A failed script's earlier calls aren't undone, so `act` capabilities must be safe to repeat or checked
  (the Delivery Gate for messages).
- Still to come on this base: messaging sessions through the Delivery Gate (the project's Coordinator only),
  session watches that wake a Sprocket, and shared project notes (Sprockets don't message each other).
