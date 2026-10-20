# Test runs

A harness for trying Rails the way it's meant to be used: real coding agents (Claude Code, Codex, pi) in panels,
a Sprocket looking after the project, and you acting as the user, on a brief big enough to need coordination. It
sets everything up, shows you what needs you, keeps a log of what you did, reports the numbers, and cleans up.
The first run (a tower-defense game, three agents, about 1.5 hours) found the bugs fixed in ADR 0016 and the
decisions in it; `gearworks.example.json` repeats it.

```sh
cp scripts/test-run/gearworks.example.json my-run.json   # edit: name, project folder, home, ports
npm run test-run -- setup my-run.json
npm run test-run -- prompt engine @prompts/engine.md       # or text
npm run test-run -- watch                                  # returns when something needs you
npm run test-run -- send 3f2a91c0                          # or --text "edited" --why "…"
npm run test-run -- dismiss 7b1e04aa --why "wrong session"
npm run test-run -- note "pi stalled on a question dialog"
npm run test-run -- commit "Build the engine"
npm run test-run -- report
npm run test-run -- cleanup                                # --remove-project, --keep-transcripts
```

`npm run test-run -- help` lists the commands. After `setup`, commands act on the most recent run (`--run <name>`
picks another). Each run keeps its state, log, server logs and report in `.test-runs/<name>/` (gitignored).

## The config

- `project`: a new or empty folder. The brief is copied in as `BRIEF.md` and committed.
- `rails.home`: the run's `RAILS_HOME`. The Sprocket's model and the decision model need their providers set up
  there, so either sign in once in a fresh home, or reuse one that has them (`"reuseHome": true`: cleanup keeps it).
  Never share a home with a server that's running: two servers would both manage its panels.
- `rails.port`, `rails.webPort`: the run's own ports (4319 and 5180 by default, so they don't meet `make dev`).
  With `webPort`, Vite serves the UI on the LAN at `http://<host>:<webPort>/?token=t`.
- `rails.launcher`: a script that starts the server instead of `packages/server/src/index.ts`, e.g. one that
  installs a scripted model for a repeatable check of the harness itself.
- `decisionModel`: a classifier ref, `null` to turn it off, or left out to keep the home's setting.
- `sprocket`: the project's one Sprocket (its Coordinator): name, model, description, rules.
- `agents`: each with a `name` (for `prompt`), its `kind`, and optionally its `model`, as the agent's `/model`
  picker labels it ("Sonnet 5.5", "gpt-6-luna"). Picking a model is for that session only: your defaults stay.
  Codex runs on its default model.

## What setup does to each agent

- Claude Code and Codex ask whether to trust a new folder: setup says yes. Codex saves that in
  `~/.codex/config.toml`; cleanup removes the entry if the run added it.
- The model is found by its label on screen, never by its position in the list.
- pi: a `guard` extension, if you have one, asks before every edit and command; setup runs `/guard off` for that
  session (`/guard` alone toggles it).

## While it runs

You're the user: type prompts, answer what agents ask, and decide on the Sprocket's drafts. `watch` returns when a
draft waits, the Sprocket said something, an agent waits or seems to ask something on its screen, or every agent
is idle. `send` and `dismiss` log whether you edited a draft and why you dropped one, which the report counts:
check a draft before sending it (open the files, run the tests), as you would for real.

To look at the project in a browser, serve it yourself (for example `python3 -m http.server` in the project).
Browser automation here goes through the remote browser described in the global AGENTS.md; if a canvas app looks
frozen, the tab may have gone to the background (`document.visibilityState` is `hidden`): reopen it.

## Cleanup

`cleanup` writes the report, closes the panels (which stops the agents), deletes the Sprocket, detaches the
project, puts back a reused home's decision model, stops the run's servers and removes the home (unless reused).
It deletes only what the run created: the transcripts of its agents' own sessions (noted by `status` as the run
goes, and from the database at the end), their Codex threads through Codex's daemon (as a client), a transcript
folder the run created once no one else's transcript is in it, and Codex's trust entry if the run added it. Other
Codex threads started in the project folder during the run are listed, not deleted: one could be yours. The
project folder stays unless `--remove-project`.

Claude Code records each folder it's told to trust in `~/.claude.json`; cleanup leaves that file alone (running
Claude Code sessions rewrite it), so a run leaves one `projects["<folder>"]` entry there.
