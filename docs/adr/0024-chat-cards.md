# ADR 0024: Cards in chats

Status: accepted (builds on ADR 0008's capabilities and ADR 0023's several messages per run).

A Sprocket could only write text. A comparison of three databases came as paragraphs, a launch checklist as a
numbered list with no sense of how far along it was, and a diff as a code block among chat bubbles that split
it like any other paragraph. Chat products show such things as structured pieces in the thread: a table under
a title, facts as label and value, rows with a check.

We looked at OpenUI (github.com/thesysdev/openui), an open, MIT-licensed generative-UI framework: the model
writes a compact language, and a React renderer draws it from a component library the app defines. It would
have fit React 19. We didn't adopt it, for now:
- Its core package (`@openuidev/lang-core`) sends install telemetry to a third party on every `npm install`,
  unless the installer sets `OPENUI_TELEMETRY_DISABLED` or `DO_NOT_TRACK`. A self-hosted app can't promise that.
- Its strengths are streaming, forms, data queries and dashboards. Team replies aren't streamed (ADR 0022's
  faces and whole bubbles), and cards in a chat need none of the rest yet.
- It brings zod, a devtools package and about 1.8 MB unpacked, beside pi-ai's TypeBox, which every capability
  already uses.
If forms that act or live dashboards come, OpenUI is the first thing to look at again.

Decisions:
- **A card is shown with a capability**, `show_card({ title?, blocks })`, in direct and team chats (where
  `send_message` is; not the project chat, whose reply shape the Coordinator check measures). It posts the card
  as a message of its own right away, and the turn goes on. At most 3 per run.
- **A card is a title and one to six blocks**, each one of: `text`, `table` (columns and rows of text),
  `facts` (label and value), `list` (bulleted or numbered), `checklist` (items that are done, doing or todo),
  `code` and `diff` (a unified diff). Limits (`CARD_LIMITS` in `shared`) cap rows, items and lengths. TypeBox
  checks a call like any other; Rails also refuses a table row that doesn't fit its columns. Nothing in a card
  is HTML or a link: Rails draws every part from its own components.
- **A card is read-only.** It shows; it doesn't take input. A Sprocket that wants a choice asks with
  `ask_user` (ADR 0023), and an updated checklist is a new card.
- **Stored on the message** as `card` (JSON), with `text` holding the card as plain text (`cardText`: a table
  as a Markdown table, a checklist as `[x]`, `[~]` and `[ ]`). That text is what copying gives and what the
  Sprocket list previews ("Card: Launch QA"). The model sees a card as Rails' note ("You showed a card:" and
  that text), so it doesn't take up writing Markdown tables itself.
- **An echo capability tells the model what it did on screen.** Models often call a capability without
  printing its result, and a model that saw only "Script completed" wrote its card out again as text. A
  capability marked `echo` (`show_card`, `send_message`) has its result added to the script's output when the
  script didn't print it ("show_card: Shown: your user sees the card now…").
- **Drawn in DESIGN.md's terms** (`sprockets/Card.tsx`): square, `--surface` with its edge, the title on a
  rule, blocks ruled apart; tables with small capitals over their columns, a rule between rows and tabular
  numbers, scrolling sideways on a phone; a checklist's states in green, amber and muted with words for screen
  readers; code and diffs in Space Mono with the diff tokens. A card pops in like a bubble.

Consequences:
- Sprockets choose when a card helps. In testing they showed a comparison, a checklist and a diff as cards and
  answered a sum or a short question in text.
- A model may still put advice into a card's text block that it then says again in its message.
- New block types are a type in `shared`, a schema in `harness/cards.ts`, a line in `cardText` and a block in
  `Card.tsx`.
