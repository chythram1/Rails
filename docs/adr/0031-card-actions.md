# ADR 0031: Cards that act

Status: proposed (builds on ADR 0024's cards and ADR 0025's connectors and approvals).

A Sprocket's card could only show things. To act on a connector it called the tool itself (an allow tool) or
asked for it with an approval card (an ask tool): one call per run, its turn ended while it waited, and the
user saw one call at a time. "Make these three Linear issues" meant three approvals across three runs, or
three calls the user never saw before they ran.

Other chat products put actions on what they show: ChatGPT's cards and its apps' widgets (a widget calls its
app's tools; a write tool is confirmed), Notion AI's propose-then-save, and MCP Apps, the MCP extension that
lets a connector ship its own interactive view. We looked at OpenUI again (still 1.0.1): its buttons run
tool calls in the browser, and the button the model wrote is the only authorization ("restricted slots are not
enforced yet"); its install telemetry is still on by default. Research: `scratch/research/intelligent-ui/
cards-that-act.md`.

Decisions:
- **A card can end with actions**: one to five, each a call to a tool of one of the Sprocket's connectors (a
  tool that isn't off), with arguments the Sprocket fills in, and a short label ("Create 'Fix login timeout'").
  `show_card` takes them as `actions: [{ label, server, tool, args }]`. Rails checks each when the card is
  shown: the server is in the Sprocket's toolbox, the tool exists and isn't off, and the arguments fit the
  tool's input schema; a card with an action that doesn't fit isn't shown, and the Sprocket hears why.
- **Each action shows what it will do** under its label: the service, the tool, and its arguments, the way
  the approval card shows them. The user can **Run** it or **Skip** it; with more than one waiting, **Run all**.
- **Tapping Run is the approval.** The card has shown the exact call, so an ask tool needs no second card.
  Rails checks again at the tap (the server still there, still in the toolbox, the tool not turned off since)
  and makes the call on the server, as `approvals.ts` does; nothing runs in the browser. A tool marked
  destructive (`destructiveHint`, now kept beside `readOnlyHint`) asks once more on the button itself
  ("Delete it?"). Rails' approval card works this way already, and connector hosts treat a write that the user
  confirmed with its arguments shown as approved (ChatGPT's apps confirm once per write tool).
- **Arguments are read-only.** To change one, the user says so in the chat and the Sprocket shows a new card.
  Approval cards in Rails, ChatGPT and Claude all show a call's arguments without editing them; an editor built
  from an arbitrary JSON schema (nested objects, arrays) is new and untested ground, so it waits until a real
  need shows which fields are worth editing.
- **The Sprocket goes on once, when the card is settled**: every action run (done or failed) or skipped. One
  new turn sees all the results, as Claude collects the answers to several questions before sending them. If
  the user writes first, that turn sees what has run so far, and the card's remaining actions stay. A card is a
  message, not a waiting run: showing one doesn't end the turn, and nothing waits in memory.
- **Results stay on the card**: each action's state (waiting, running, done, failed, skipped) and what the call
  returned (trimmed, as approvals keep it). A double tap or a second device can't run an action twice.
- **Actions don't expire**: they stay until run, skipped, or the chat is cleared; the check at the tap covers
  what changed meanwhile.
- **Where**: direct and team chats, where cards are (in a team, the member that showed the card goes on). Not
  the project chat, whose drafts already have Send, Edit and Dismiss.
- **Replies stay `ask_user`.** Buttons that only answer ("More like this") are `ask_user`'s options, which
  already wait, route to the asker in teams and show as tappable replies; cards don't get a second kind.
- **Not now**: hosting MCP Apps (a connector's own view: a second origin for the sandbox, a content policy and
  a message bridge; first check that a connected server ships one), OpenUI, live cards.

Consequences:
- "Make these three issues" is one card, three visible calls, Run all, and one reply about what came of it.
- An action is as safe as an approval: the user saw the call, Rails re-checks policy at the tap, the server
  makes it. An allow tool on a card still waits for the tap; the Sprocket can call it itself when it shouldn't.
- Fixing a typo in an argument costs a message and a new card.
- New: `SprocketCardAction` in `shared` (on the card, with its state), the `actions` schema in
  `harness/cards.ts`, a service beside `approvals.ts` with a route, the action rows in `sprockets/Card.tsx`, and
  `destructive` on stored MCP tools.
