# ADR 0032: Automations

Status: proposed (builds on ADR 0006's Sprocket runs, ADR 0023's turn engine, ADR 0025's toolbox and ADR 0031's
card actions; the Automate item in the sidebar has been a placeholder until now).

Everything a Sprocket does starts with a message: the user's, a teammate's pass, or an event its Coordinator is woken
for. Work that should happen without anyone asking ("every weekday at 9, tell me what changed in Linear and which PRs
wait on me") had nowhere to live.

We looked at how others run agents unattended (research in `scratch/research/automate/findings.md`, mostly the
OpenHands automation service and Agent Canvas, read from source). They agree on the shape: a saved prompt, a schedule,
a run list where every run opens what it produced. They differ on writes: OpenHands lets an unattended run do
anything, Codex runs with approvals off, Claude Code lets a classifier decide and stops when it can't. Rails already
has a better answer: a write a Sprocket asks for waits on a card until the user runs it (ADR 0031), and holds no run
open meanwhile.

## Decision

- **An Automation is a Sprocket, a prompt and a schedule.** Its name, the Sprocket that runs it, the prompt (written
  as an instruction to that Sprocket), the schedule, a timezone, and whether it's on. It runs with the Sprocket's
  model, rules, connectors and skills. Sessions in panels are not part of this ADR: they edit code in the user's
  checkout, which needs a worktree per run first.
- **Runs land in the Sprocket's direct chat.** A run posts a Rails line naming the automation ("Morning brief,
  scheduled") and the Sprocket replies under it, so its cards wait where the user already talks to it, and the chat's
  history carries from one run to the next. The run's turn note says when the last run was and what it reported, so
  "what's new since last time" needs no store of its own. Team chats and the project chat don't run automations.
- **Writes wait on cards.** Unattended runs use the toolbox as it is set: allow tools run, ask tools become card
  actions (ADR 0031) that wait for Run or Skip. An automation can't send, create or delete anything the user didn't
  allow, and nothing about this is new code.
- **Every run has an outcome.** The run ends with one of: **Done** (it posted a reply), **Nothing new** (it ends with a
  capability that records a one-line summary and posts nothing in the chat, so a quiet check doesn't fill the chat),
  **Needs you** (it left card actions or a question waiting), **Failed** (an error, with Rails' readable message),
  **Skipped** (the previous run of this automation hadn't finished, or the automation was paused). The summary is the
  first line of its reply, or what it gave Nothing new.
- **Schedules**: Once, Hourly, Daily, Weekdays, Weekly (days and a time), or Custom (a cron expression), each in a
  timezone (the browser's when created). Rails refuses a cron that can never fire and one that fires more often than
  every 15 minutes. **Run now** runs one at once, whatever the schedule.
- **Due rule**: an automation is due when its schedule's latest fire time is later than its last run (or its
  creation, if it never ran). So after the server was down it runs once, not once per missed time; a new automation
  never runs for times before it existed; and nothing runs while the server is off, which the Automate page says.
- **No overlap**: a run due while the same automation's previous run is queued or running is recorded as Skipped.
  Runs share the existing limits (two runs at a time across Rails, 30 per Sprocket per hour, 12 steps a run).
- **Pause after repeated failure**: three Failed runs in a row turn the automation off with the reason ("The model
  isn't signed in", "the Sprocket was deleted") shown on its page; turning it on again clears it. Deleting the
  Sprocket deletes its automations.
- **The Automate page** (the sidebar item): a list of automations, each with the Sprocket's face, name, schedule in
  words ("Weekdays at 9:00"), the last run's outcome and time, and an on/off switch; New automation opens a form (name,
  Sprocket, prompt, schedule, timezone). An automation's page has its settings, Run now, Delete, and its runs, newest
  first: time, trigger (scheduled or run now), outcome, summary, each linking to its place in the chat.
- Runs are rows in `automation_runs` (automation, Sprocket run, trigger, outcome, summary, times), next to
  `sprocket_runs`, whose new trigger `automation` starts the Sprocket's turn. The scheduler is one timer in the server
  that checks every 30 seconds.

## Considered

- **A chat per run**: each run its own conversation. Tidier for frequent automations, but runs lose each other's
  context and Rails would gain a new kind of chat. The Nothing new outcome keeps the direct chat from filling up.
- **Sessions in panels first** (Claude Code, Codex or pi on a project): the most requested work in OpenHands' catalog
  (reviewing PRs, issue to PR). Deferred until git actions give each run its own worktree; until then a run would edit
  the files the user is working on.
- **Webhook triggers** (a PR opened, a Slack mention): a Rails server on a LAN or tailnet has no public address to
  receive them. Polling through a connector on a schedule covers most of it; events Rails sees itself (a session
  finished a turn, a session waits for the user) are the next trigger to add, since they need no address.
- **A key-value store per automation** (OpenHands has one for polling cursors): the last run's time and report in the
  turn note covers it until a real automation shows otherwise.
- **Drafts, templates, import and export**: left out of the first version. A few starter prompts can come later.
- **Creating an automation from a chat** ("check this every morning"): a capability that fills the same form for the
  user to confirm. Next, after the page exists.

## Consequences

- New: `automations.ts` (the service and scheduler), `automations` and `automation_runs` tables, REST routes, the
  Automate page, the `automation` run trigger, and a Nothing new capability offered only in automation runs.
- An automation runs only while the Rails server runs, and runs as the user: what its connectors do is done with the
  user's accounts, through the tool policies the user set in Customize.
- Frequent automations add to the Sprocket's chat and model use; the 15-minute floor, the Nothing new outcome and the
  existing hourly cap bound both.
- CONTEXT.md's Automation entry changes from "starts sessions" to "runs a Sprocket", with sessions as a later step.
