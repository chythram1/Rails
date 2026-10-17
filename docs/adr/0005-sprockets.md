# ADR 0005: Sprockets, always-on agents with characters

Status: accepted (stage 1: look and chat UI only).

Sprockets are a lightweight collection of always-on agents native to rails. Each one is a small character
the user makes: one of 8 shapes (Block, Bean, Lune, Bell, Starry, Cog, Roo, Momo), one of 10 colours,
one head accessory or none (party hat, beanie, cap, bow, flower clip, crown, bucket hat), and
a name. They have their own page (the "Sprockets" nav item): a list of Sprockets beside the selected
one's chat, or the creator. The creator follows `ref/sprockets/stage1/create-bot.jpg`: the preview on
top, then a row each for colour, accessory and shape, then the name. New Sprockets can start from a
suggestion (a preset name and look); the suggestions' names also serve as the name placeholder, which
moves to the next unused one each time the creator opens. The list column's header is a search field,
not a title, so the word "Sprockets" shows once (the nav item). With no Sprocket open, the page shows them all as cards; a chat
opens with the Sprocket itself, and time labels mark gaps between messages.

Stage 1 is visual only. Sprockets can be created, restyled, renamed and deleted, and the user can send
them messages, but nothing runs: no Sprocket replies, and the chat says so. How they run (a harness,
prompts, tools, schedules) is a later stage and gets its own decision.

Decisions:
- **Stored on the server,** like projects: SQLite tables `sprockets` (name, look as JSON) and
  `sprocket_messages` (the user's messages). Changes are broadcast as `sprockets.changed`, so every
  device sees the same Sprockets. The look's ids live in `packages/shared` (`SPROCKET_CHARACTERS`,
  `SPROCKET_COLORS`, `SPROCKET_ACCESSORIES`); the server refuses unknown ids and repairs stored looks
  whose ids no longer exist. The colours' hex values live in the web (`characters.ts`).
- **Characters are flat SVG** drawn by one renderer from data (`components/sprockets/`), following the
  method in `ref/sprockets/stage1/characters.md`: every character shares one coordinate system and
  publishes anchors (face, hat), so accessories fit any character without per-pair tuning.
- **One accessory slot.** An earlier draft had head, eyes and neck slots; one slot keeps the creator to
  three rows. Headphones were dropped too, so "none" plus 7 accessories lines up with the 8 shapes.
- **Motion:** idle loops (bob, sway; the accessory and its wobbly bits trail) are CSS; blinks, change squashes and
  accessory pop-ins use the Web Animations API; the creator's preview follows the pointer with one shared
  spring loop that stops when idle. Thumbnails are still. A pause control on the page turns the loops off
  (WCAG 2.2.2), stored per device; it starts paused when the OS asks for reduced motion.

Consequences:
- Sprockets aren't providers and don't widen ADR 0002's scope: they're rails' own agents (see the "Home
  agent" idea in the roadmap), and they don't run in panels.
- The app's no-animation rule has one exception: Sprocket characters.
