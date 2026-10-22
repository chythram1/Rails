# The Coordinator check

Replays situations from test runs 2 and 6 against the real Coordinator on a real model, a few times each, and checks
what it drafted. Use it after changing the Coordinator's instructions (`systemPrompt` and `eventText` in
`packages/server/src/runs.ts`, the tool descriptions in `harness/reply.ts`), or to compare models.

```sh
npm run coordinator-check -- [--model openai/gpt-6-luna] [--repeat 3] [--only name,name] [--label after]
```

No agents, panels or servers: each situation is a git project with the game's files, sessions made of
transcripts and the bridge events Rails would have heard, and run 2's Coordinator (its description, rules and
owners). The check wakes it the way Rails does (an event, or a message from the user), waits for its run, and
checks its drafts with plain text rules. Runs the provider failed (a dropped connection, a timeout) are played
again, up to twice.

The situations (`scenarios.ts`):

| Name | What it checks |
| --- | --- |
| `simpler-choice` | A rule that says "pick the simpler one" is followed even when the session recommends the other. |
| `yes-no-rule` | A "go ahead?" question cites the go-ahead rule, not "pick the simpler one". |
| `keep-the-requirement` | Findings go to their owners, and "at most one early start" stays that. |
| `name-the-cause` | A message about broken tests says what broke them. |
| `harmless-overlap` | Two compatible changes to one file get (quiet) and no draft. |
| `real-clash` | A change that undoes another's work does get a heads-up. |
| `owner-reviews` | A handoff tells the owner which of its files another session changed, to review them. |
| `done-not-continue` | A handoff to a finished session doesn't tell it to continue, or to talk to another session. |
| `several-events` | Two events that come in together (a go-ahead and a dialog, test run 6) both get an answer. |
| `handoff-covered` | A handoff the finished session already carried out with its own message isn't drafted again (runs 4 to 6). |

**Sign-in.** The model needs a provider in the check's home, `/tmp/rails-check` by default (`--home`). Sign in
once: start a server with `RAILS_HOME=/tmp/rails-check RAILS_PORT=4319 RAILS_TOKEN=t` (and Vite on another
port), connect the provider in Settings → Providers, and stop it. Each check keeps only `credentials.json`
there and deletes the rest of its state. So it refuses a home a server is using, one that holds more than a
sign-in and its own files (a home that has had panels), and, the first time, one with projects; then it marks
the home as its own (`.coordinator-check`).

**Results.** It prints each check's score and writes a report with every reply, draft and tool call to
`.test-runs/coordinator-check/<label>-<model>-<time>.md` (gitignored). Models vary from run to run: compare
with `--repeat 5` or more before trusting a difference of one or two. It's a measurement, not a test: it exits
0 whenever it ran, whatever the score, and 1 only when it couldn't run.
