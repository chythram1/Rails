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
each is drawn as the front of a body with its own thickness and roundness (`solid.ts`; `depth` and `puff` in
`characters.ts`): slices of the outline, back to front, all in its colour, shrinking toward the front and back on a
round body. Turned or tipped it's seen in true perspective, so a thin body (Block, a pizza box) narrows to a sliver
while a deep, soft one (Bean, Bell, Momo) stays round from every side; one depth for all made them all look like the
same cylinder. The eyes ride the front, slanting as they would on a dome. There's no shading: a darker side read as
stacked layers. Facing you it's exactly the flat drawing, so every character keeps its
look. One set of springs (now a rig in `engine.ts`, ADR 0035) moves its turn, tip, roll, lean, hop and squash, painted straight into the
SVG. The poses: resting almost facing you and still, glancing now and then; facing
you in its open chat's row; following the pointer in a hovered row and in the creator; while thinking, one small move
after another (pondering, looking about, peeking, nodding, tilting, a bounce, a scrunch, now and then a spin),
and on top of those, most often, leaning in toward the screen and pulsing there while glancing to the viewer's left (gentler at rest);
looking up toward its message, rocking back a little, when done in a team, after cheering (happy eyes and a dance)
as the message arrives. Its own row in the list thinks while it works in any of its chats and cheers as its message
lands; a team's picture stays still. The constant bob and sway, the per-character tempo and the spin's streaks are gone.
It's not a 3D model (there's no mesh or lighting): bodies are any 2D outline, so the depth follows the outline.

