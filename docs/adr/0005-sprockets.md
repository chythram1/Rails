# ADR 0005: Sprockets, always-on agents with characters

Status: accepted (stage 1: look and chat UI only). Accessories are gone (amendment below).

Sprockets are a lightweight collection of always-on agents native to Rails. Each one is a small character
the user makes: one of 8 shapes (Block, Bean, Lune, Bell, Starry, Cog, Roo, Momo), one of 10 colours,
one head accessory or none (party hat, beanie, cap, bow, flower clip, crown, bucket hat), and
a name. They have their own page (the "Sprockets" nav item): a list of Sprockets beside the selected
one's chat, or the creator. The creator follows `ref/sprockets/stage1/create-bot.jpg`: the preview on
top, then a row each for colour, accessory and shape, then the name. The empty name field cycles through
name ideas (an empty name takes the one showing). The list column's header is a search field, not a
title, so the word "Sprockets" shows once (the nav item). With no Sprocket open, the page shows them all as cards; a chat
opens with the Sprocket itself, and time labels mark gaps between messages.

Stage 1 is visual only. Sprockets can be created, restyled, renamed and deleted (restyling was dropped
later: a Sprocket's look is chosen once, when it's made), and the user can send
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
  spring loop that stops when idle. Thumbnails are still. Small avatars bob and sway more (and faster)
  than big ones, so the motion reads at list size. There's no in-app pause control: the loops are cheap,
  and they stop when the OS asks for reduced motion. (WCAG 2.2.2 asks for a pause control for motion
  over 5s; revisit if that matters.)

Consequences:
- Sprockets aren't providers and don't widen ADR 0002's scope: they're Rails' own agents (see the "Home
  agent" idea in the roadmap), and they don't run in panels.
- The app's no-animation rule has one exception: Sprocket characters.

Amendment (2026-10-24): no accessories. A team's thinking icon (ADR 0033) turns one member's body into the next, and a
hat can't melt with a body, so a Sprocket is a shape and a colour. The creator has two rows; looks stored with an
accessory still load (it's dropped), and a client that sends one isn't refused. The hat anchors, the accessory
drawings and their pop-in and wobble motion went with them.

Amendment (2026-10-24, later): Sprockets are solids that turn. Characters bobbed and swayed all the time and only
their eyes moved about; a flat drawing can't look somewhere else, or show it's busy except by moving faster. Now
each is drawn as the front of a soft, round body with some depth (`solid.ts`): the body's outline in layers, back to
front, all in its colour. Turned or tipped, the body hardly narrows; its face travels across it toward where it looks,
the eyes narrowing near the edge, and the depth swells the outline on the far side. Only a spin passes through
edge-on, a sliver, to its back. There's no shading: a darker side read as stacked layers, and narrowing the whole
body with the turn made characters look thin. Facing you it's exactly the flat drawing, so every character keeps its
look. One set of springs (`motion.ts`) moves its turn, tip, roll, lean, hop and squash, painted straight into the
SVG. The poses: resting almost facing you and still, glancing now and then; facing
you in its open chat's row; following the pointer in a hovered row and in the creator; while thinking, one small move
after another (pondering, looking about, peeking, nodding, tilting, leaning in toward the screen, a bounce, a
scrunch, now and then a spin);
looking up and leaning toward its message when done in a team, after a short dance with happy eyes as the message
arrives. The constant bob and sway, the per-character tempo and the spin's streaks are gone.
It's not a 3D model (there's no mesh or lighting): bodies are any 2D outline, so the depth follows the outline.

