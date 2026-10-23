# ADR 0011: Standing rules for Coordinators

Status: accepted (Sprockets step 3, part 3 of "unblock waiting sessions"; builds on ADR 0009 and 0010).

A Coordinator suggests replies from its judgment: the user's description, its memory and the project. That
leaves the user unable to see why it suggested something, and gives nothing to hand autonomy to later: the
end goal is that a Coordinator answers some questions by itself, and "trust this Sprocket" is too coarse a
switch for that. Standing rules are the unit: the user writes how sessions should be answered, one rule at a
time, and every suggestion says which rule it followed.

Decisions:
- **Rules belong to the Sprocket**, like its description: a list of plain sentences ("If it asks whether to
  continue with its plan, say yes."), at most 10 of 200 characters each. They stay with it when it moves to
  another project. They're edited under the Coordinator switch in its settings, and shown only while it's a
  Coordinator: rules are about answering sessions.
- **No structure beyond the sentence.** The Coordinator reads them numbered and decides which one fits; the
  trigger isn't a separate field. Exact triggers in code can come back if a rule needs one.
- **Rules first, then judgment.** A rule that fits beats the Coordinator's own judgment; without one it
  suggests as before. `suggest_reply` takes the rule's number, which is resolved against the rules the run
  read (the user may edit them meanwhile), and the suggestion keeps the rule's text. The card shows
  "Following your rule: …"; a suggestion without one is the Coordinator's judgment. The tool's result repeats
  the cited rule's words, so the model checks it fits the question and was followed (in test run 2 it cited
  "pick the simpler one" for a yes-or-no question, and for picking the more complex option). It reads a rule as
  written: "the simpler one" is the option with fewer new mechanics and less code, whichever the session
  recommends or sounds more interesting (test run 9 picked a healing enemy over a speed change by that rule).
- **Rules can't widen what a Coordinator may do.** No rule lets it suggest approving a permission or a
  command, or send anything without the user (ADR 0010).

Not yet: a per-rule switch from "suggest" to "do it" (automatic answers, the end goal), which needs a way to
see how often the user sends a rule's suggestions unchanged; and a fast classifier matching events to rules.
