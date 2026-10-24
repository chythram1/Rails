# The Coordinator check

Replays situations from test runs 2, 6 and 7 against the real Coordinator on a real model, a few times each, and checks
what it drafted. Use it after changing the Coordinator's instructions (`systemPrompt` and `eventText` in
`packages/server/src/sprockets/prompt.ts`, the tool descriptions in `harness/reply.ts`), or to compare models.

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
| `simpler-choice-healer` | Two enemies with no recommendation, one with a healing aura (run 9): rule 2 picks the speed one. |
| `yes-no-rule` | A "go ahead?" question cites the go-ahead rule, not "pick the simpler one". |
| `keep-the-requirement` | Findings go to their owners, and "at most one early start" stays that. |
| `name-the-cause` | A message about broken tests says what broke them. |
| `harmless-overlap` | Two compatible changes to one file get (quiet) and no draft. |
| `real-clash` | A change that undoes another's work does get a heads-up. |
| `owner-reviews` | A handoff tells the owner which of its files another session changed, to review them. |
| `done-not-continue` | A handoff to a finished session doesn't tell it to continue, or to talk to another session. |
| `several-events` | Two events that come in together (a go-ahead and a dialog, test run 6) both get an answer. |
| `handoff-covered` | A handoff the finished session already carried out with its own message isn't drafted again (runs 4 to 6). |
| `covered-pair` | Two handoffs in one run, one of them already covered by the session's own message (run 8): only the other gets a draft. |
| `overlap-while-working` | An additive change to a file whose owner is still working on it (run 8) stays quiet. |
| `overlap-shared-test` | Coordinates updated in a test another session added to (run 8) stay quiet. |
| `handoff-already-done` | A handoff whose work the receiving session already did (runs 7, 8) isn't drafted again. |
| `note-for-later` | A note for the Coordinator (how to answer a question when it comes) isn't drafted as a message now, and is used when the question comes. |
| `finding-routes` | A problem in another session's files, named in a reply that didn't tell it (runs 4, 7), gets a message for that session. |
| `finding-harmless` | A reply that names another session's file only to say it works stays quiet. |
| `contract-rename` | A renamed field another session reads (runs 9, 10) gets that session a message. |
| `finding-unlisted` | A finding whose work belongs to a session the event doesn't list (run 10) reaches that session. |
| `own-draft-sent` | A question that's only about sending the session's own, already sent, message (run 10) gets no new draft. |
| `ownership-breach` | Changes in another session's files (run 10) get a heads-up to move them out, with who did what right. |
| `permission-deny` | A session waiting on a permission the rules forbid (installing a package, test run 7): tell the user not to allow it, draft nothing. |
| `permission-allow` | A permission the rules allow (running the tests): tell the user it's fine, draft nothing. |

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
