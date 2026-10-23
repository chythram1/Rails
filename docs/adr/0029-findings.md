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
  name for files it changed; a folder only by its owner, as in test run 8 `node --test tests/` matched every test
  file two sessions had changed), and the same sentence says something is wrong or needed ("doesn't", "expects",
  "missing", "should", "mismatch", …). Files the reporting session changed itself are left to overlaps.
- **Not twice:** nothing wakes for a session the reporting one already wrote to in the last 10 minutes (ADR 0018),
  or has a handoff planned to (ADR 0015), and a pair of sessions wakes it once per file per 30 minutes.
- **The wake** is a `finding` event in the project chat: the reporting session, the sessions and files named, and
  the end of its reply. The Coordinator reads the reply and drafts that session a message with `suggest_message`
  (what was found, by whom, where, what to do), or replies (quiet) when the file is only mentioned, used or fine, or
  the work there is already done. As with every draft, the user sends it.
- **The decision model**, when one is set, is asked first: "does it name work another session has to do?", with
  the other sessions and what each owns or changed as context, and in the same call "does it ask the user
  something?". When it's sure (`FINDING_BAR`, 0.7) its answer decides: a finding wakes the Coordinator even when
  the reply names no file (the event then names no session, and the Coordinator finds out whose it is), no finding
  stops the rule's wake, and a reply it hears asking is left to that wake. When it isn't sure, fails, times out
  (8 s), or there's none, or `RAILS_DECISIONS=shadow`, the rule decides. So Rails works the same without a model;
  with one, a finding's wake waits for its answer, a few seconds at most. Every answer is logged next to the
  rule's (Settings → Models).

Consequences:
- The rule is a heuristic: it misses a finding that names no file (a role, "the UI session should…"), and it
  wakes for a reply that names a file next to a cue word without meaning a problem. The Coordinator's (quiet)
  absorbs the second (a run, no draft); the model, when set, fixes both where it's sure. In test run 8, where it
  only shadowed, it was right on all five turn ends where it or the rule saw a finding, including the rule's two
  false wakes and one miss ("add `runner` to its roster label map": the Boiler Runner then went missing from
  How to play for a fourth run).
- Agents are told to message the other session themselves rather than only noting such things in their reply
  (the `message` tool's description, ADR 0018); findings catch what they still don't send, and Codex's, which
  has no agent tools.
- scripts/coordinator-check has `finding-routes` (a real finding gets a message for its owner) and
  `finding-harmless` (a mention that says it works stays quiet).
