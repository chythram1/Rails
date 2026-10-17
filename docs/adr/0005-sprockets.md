# ADR 0005: Sprockets, always-on agents with characters

Status: accepted (stage 1: look and chat UI only).

Sprockets are a lightweight collection of always-on agents native to rails. Each one is a small character
the user makes: one of 8 characters (Block, Bean, Lune, Bell, Starry, Cog, Roo, Momo), at most one
accessory per slot (head: beanie, cap, bow, crown, headphones; eyes: sunglasses, glasses; neck: scarf),
and a name. They have their own page (the "Sprockets" nav item): a list of Sprockets beside the selected
one's chat, or the creator.

Stage 1 is visual only. Sprockets can be created, restyled, renamed and deleted, and the user can send
them messages, but nothing runs: no Sprocket replies, and the chat says so. How they run (a harness,
prompts, tools, schedules) is a later stage and gets its own decision.

Decisions:
- **Stored on the server,** like projects: SQLite tables `sprockets` (name, look as JSON) and
  `sprocket_messages` (the user's messages). Changes are broadcast as `sprockets.changed`, so every
  device sees the same Sprockets. The look's ids live in `packages/shared` (`SPROCKET_CHARACTERS`,
  `SPROCKET_SLOTS`); the server refuses unknown ids and repairs stored looks whose ids no longer exist.
- **Characters are flat SVG** drawn by one renderer from data (`components/sprockets/`), following the
  method in `ref/sprockets/stage1/characters.md`: every character shares one coordinate system and
  publishes anchors (face, hat, ears, neck), so accessories fit any character without per-pair tuning.
- **Motion:** idle loops (bob, sway; hats and dangling bits trail) are CSS; blinks, change squashes and
  accessory pop-ins use the Web Animations API; the creator's preview follows the pointer with one shared
  spring loop that stops when idle. Thumbnails are still. A pause control on the page turns the loops off
  (WCAG 2.2.2), stored per device; it starts paused when the OS asks for reduced motion.

Consequences:
- Sprockets aren't providers and don't widen ADR 0002's scope: they're rails' own agents (see the "Home
  agent" idea in the roadmap), and they don't run in panels.
- The app's no-animation rule has one exception: Sprocket characters.
- Each character keeps a fixed colour; there is no colour picker.
