# ADR 0029: Findings in replies wake the Coordinator

Status: accepted. It adds a wake to ADR 0009's, next to overlaps (ADR 0014) and handoffs (ADR 0015).

A session often finds something another session has to fix, says so in its reply, and stops there: in test run 7,
Claude Code noticed that pi's `audio.js` listened for `shot`/`hit`/`explosion` while the game emitted
`projectile:*`, wrote it in its reply, and neither messaged pi (ADR 0018) nor asked the user. Nothing woke anyone:
a turn end wakes the Coordinator only when it asks the user something. Run 4 lost two follow-ups the same way,
one from Codex, which has no agent tools at all.

Decisions:
- **Rails' rule, in plain code** (`findings.ts`), so it works without the decision model (which stays optional,
  ADR 0012). A turn end that doesn't ask the user anything is a finding for another live session when a sentence
  of the reply names a file that session owns (ADR 0016) or changed in the last 30 minutes (by path, or by file
  name for files it changed), and the same sentence says something is wrong or needed ("doesn't", "expects",
  "missing", "should", "mismatch", …). Files the reporting session changed itself are left to overlaps.
- **Not twice:** nothing wakes for a session the reporting one already wrote to in the last 10 minutes (ADR 0018),
  or has a handoff planned to (ADR 0015), and a pair of sessions wakes it once per file per 30 minutes.
- **The wake** is a `finding` event in the project chat: the reporting session, the sessions and files named, and
  the end of its reply. The Coordinator reads the reply and drafts that session a message with `suggest_message`
  (what was found, by whom, where, what to do), or replies (quiet) when the file is only mentioned, used or fine, or
  the work there is already done. As with every draft, the user sends it.
- **The decision model**, when one is set, judges the same turn ends in shadow: "does it name work another session
  has to do?", with the other sessions and what each owns or changed as context. Its answer is only logged next
  to the rule's (Settings → Models), to tune the rule; it never wakes anyone for a finding.

Consequences:
- The rule is a heuristic: it misses a finding that names no file (a role, "the UI session should…"), and it
  wakes for a reply that names a file next to a cue word without meaning a problem. The Coordinator's (quiet)
  absorbs the second (a run, no draft); the shadow log measures both.
- scripts/coordinator-check has `finding-routes` (a real finding gets a message for its owner) and
  `finding-harmless` (a mention that says it works stays quiet).
