# ADR 0012: A fast decision model judges in shadow

Status: accepted (Sprockets step 3; research in `scratch/research/system-one`).

Watches decide in code when to wake a Coordinator (ADR 0009). The question check is plain rules: cheap and
predictable, but it misses questions worded without a question mark or a known phrase, and it can't tell a pi
extension's dialog that asks something from one that asks for approval, so it ignores those. Fast "System 1"
models answer typed questions (yes/no, one of a few options) in a fraction of a second for a fraction of a cent,
which suits deciding about every turn end. Whether one does better than the rules on the user's own sessions is
unknown, and a wrong wake costs a model run, a missed one costs the user's time. So it starts in shadow: it
judges, Rails logs, nothing acts on it.

Decisions:
- **Any classifier pi-ai offers** (`models.classify()`): TypeSafe's Jev (TypeSafe is now a provider in
  Settings → Models, API key only, with no chat models), OpenAI's GPT-6 Luna as a classifier (`openai-decisions`),
  and others pi-ai lists. One setting, the decision model, off by default.
- **What it judges, in projects with a Coordinator only:**
  - every turn end: "does the end of this message ask the user something?" (a yes/no with its probability), next
    to `looksLikeQuestion`'s answer;
  - every dialog Rails doesn't know (a pi extension's, without questions): "a question, an approval or
    something else?". Rails still never wakes anyone for those.
  Permission prompts, dialogs with questions and forms are exact already, and aren't judged.
- **Bounded:** the model sees the agent's name and the last 1,500 characters of the message (or the dialog's
  title), nothing else; 8 s per call; at most 20 calls a minute across sessions (more are logged as skipped).
  Failures are logged too.
- **The shadow log** (Settings → Models, under the decision model; `decisions` table, the latest 500): each
  judgment with Rails' own decision, the model's answer and probability, the model version the service
  reported, latency and cost. A turn end that woke the Coordinator links to that wake, so the log shows the
  Coordinator's verdict ("told you" or "nothing needed"). A summary counts agreements, questions Rails missed,
  and wakes the model thought unneeded (and how many of those the Coordinator found nothing in).
- **Privacy:** the session text goes to the decision model's provider. That's said where the model is picked.

Not yet: acting on it. Once the log shows where the model is reliably better than the rules, the next steps are
letting it wake the Coordinator for questions the rules miss, matching an event to the user's standing rules
(ADR 0011), and telling questions from approvals in unknown dialogs. Each becomes its own decision, with the
threshold chosen from the log.
