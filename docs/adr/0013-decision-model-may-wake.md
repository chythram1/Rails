# ADR 0013: The decision model may wake the Coordinator

Status: accepted (builds on ADR 0009 and 0012).

ADR 0012 put a fast decision model in shadow next to the watches' rules. A first evaluation with TypeSafe's Jev
(`scratch/research/system-one/eval`) found it right where the rules are wrong by design: questions without a
question mark, a question followed by more text, and telling a pi extension's question from an approval. Real
questions scored 0.81 to 0.99, non-questions at most 0.78; dialogs it called questions 0.95 and up, approvals 1.0.
So it may now act, in the one direction where a mistake is cheap.

Decisions:
- **One control.** Picking a decision model in Settings → Models turns this on; Off turns it off. A separate
  "only judge" mode is for evaluating a model, not for users: the developer setting `RAILS_DECISIONS=shadow`
  keeps it to judging and logging (ADR 0012). What it decided stays visible under a collapsed "Recent decisions",
  for when a wake needs explaining.
- **It only adds wakes, never removes one.** It wakes the Coordinator for a turn end the rules thought didn't ask,
  when it's at least 0.9 sure it does (`ACT_ASKS`), and for a dialog Rails doesn't know, when it's at least 0.95
  sure it's a question (`ACT_QUESTION`). A wake the rules make stands whatever the model says: a missed question
  costs the user's time, a needless wake one run that ends "nothing needed".
- **High bars on purpose.** On the evaluation, 0.9 would have caught three of the four questions the rules missed
  (the fourth scored 0.81) with no false wake; the bars come down only if the shadow log shows they can.
  Changed 2026-10-21: the user can move the reply's bar themselves (Settings → Models, "Wake threshold", a slider
  from 50% to 99%, default 90%); a dialog's bar stays 5 points above it, at most 99%. The slider turns amber below
  85% and red below 80%, since messages that asked nothing scored up to 0.78.
- **The usual watch rules apply:** the grace period, the cooldown, one wake per wait. A judgment the session has
  moved on from (it reported anything since) wakes nothing.
- **It shows.** The event says the decision model caught it, and the Coordinator is told to check it ("if it
  doesn't really ask your user anything, reply (quiet)"). The log marks the judgments that woke the Coordinator,
  with its verdict, and counts them.
- **A dialog it calls a question still can't get a suggested answer.** It might be an approval, so the
  Coordinator only tells the user what it seems to ask (suggestions keep ADR 0010's rules).
