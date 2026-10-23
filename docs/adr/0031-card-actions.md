# ADR 0031: Cards that act

Status: accepted (builds on ADR 0024's cards; changes how ADR 0025's ask tools reach the user in direct and team
chats).

To act on a connector, a Sprocket called the tool itself (an allow tool) or asked for it with an approval card (an
ask tool): one call per run, its turn ended while it waited, and the user saw one call at a time. "Add notes for
Ada and Bo" became one approval, or one note with both in it ("I can add one note at a time").

Other chat products put actions where they show things: ChatGPT's apps (a widget calls its app's tools; a write
tool is confirmed with its arguments shown), Notion AI's propose-then-save, and MCP Apps, the MCP extension that
lets a connector ship its own view. We looked at OpenUI again (still 1.0.1): its buttons run tool calls in the
browser, and the button the model wrote is the only authorization ("restricted slots are not enforced yet"); its
install telemetry is still on by default. Research: `scratch/research/intelligent-ui/cards-that-act.md`.

Decisions:
- **An ask tool's call goes on a card** in direct and team chats. Calling it doesn't run it: Rails posts a card,
  "Wants to use <server>", with the call as an action, and the turn goes on. The run's further calls join that card
  (up to 5; then a new one). In a team the card is the member's that called it. The project chat has no MCP tools
  (ADR 0025), so approvals are what's left of the old path there: never, today; old pending approvals still decide.
- **One route, not two.** We first also let `show_card` take actions. Live, models picked between the two routes
  unevenly (a team member asked for an approval in 2 of 4 tries where the direct chat used a card 4 of 4), and when
  both were offered they used both, so the same calls showed on two cards. With the tool call as the only route,
  12 of 12 live tries gave one card with every call, the same in a direct chat and a team. `show_card` stays
  read-only (ADR 0024). An allow tool still runs when called: that's what allow means.
- **Each action shows what it will do**: a label (the tool's title, "Add note"), the service and tool, and its
  arguments, checked against the tool's schema when it was called. The user can **Run** or **Skip** each; with more
  than one waiting, **Run all** runs them in order.
- **Tapping Run is the approval.** The card has shown the exact call, so nothing asks again. Rails checks at the tap
  (the server still there, still in the Sprocket's toolbox, the tool not turned off since) and makes the call on the
  server, as `approvals.ts` did; nothing runs in the browser. A tool its server marks destructive
  (`destructiveHint: true`, kept as `destructive` on stored tools) asks once more on the button ("Yes, run it").
  Only an explicit hint counts: MCP's default (destructive unless marked otherwise) would ask twice for every write.
- **Arguments are read-only.** To change one, the user says so and the Sprocket proposes again. Approval prompts in
  Rails, ChatGPT and Claude all show a call's arguments without editing them; an editor for any tool's schema
  (nested objects, lists) is untested ground, so it waits until a real need shows which fields to edit.
- **The Sprocket goes on once, when the card is settled**: every action run (done or failed) or skipped. One new run
  (trigger `actions`) sees all the results, the same in both kinds of chat: in a team, the member whose card it is,
  outside any round (no go-round or hand-on reminders, ADR 0023). If the user writes first, that run sees what has
  run so far, and the card's remaining actions stay. Nothing waits in memory: the card is the record.
- **Results stay on the card**: each action's state (waiting, running, done, failed, skipped) and the first 4000
  characters of what it returned. A double tap or a second device can't run an action twice. Settled actions fold to
  one line (label, first text argument, outcome).
- **Actions don't expire**: they stay until run, skipped, or the chat is cleared; the check at the tap covers what
  changed meanwhile.
- **Not now**: hosting MCP Apps (a connector's own view: a second origin for the sandbox, a content policy and a
  message bridge; first check that a connected server ships one), OpenUI, live cards, reply buttons on cards (answers
  are `ask_user`'s options).

Consequences:
- "Add these three notes" is one card, three visible calls, Run all, and one reply about what came of it.
- An action is as safe as an approval was: the user saw the call, Rails re-checks policy at the tap, the server
  makes it.
- A Sprocket can't title a card of actions or put context on it; it says what they're for in its message, or shows a
  read-only card first.
- Fixing a typo in an argument costs a message and a new card.
- Code: `SprocketCardAction` in `shared` (on the card), `propose` in `runs.ts` (from `harness/mcpTools.ts`),
  `cardActions.ts` with `POST /api/cards/:messageId/actions` (`{ index?, run }`), `sprockets/CardActions.tsx`.
