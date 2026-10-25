# ADR 0035: One motion engine for Sprockets, and a lab to look at it

Status: accepted. It replaces how ADR 0005's amendments animated Sprockets; their poses and motions stay the same.

Sprocket motion grew one piece at a time. A Sprocket took six flags (`still`, `stance`, `follow`, `busy`, `spin`,
`cheer`), some of which made no sense together. Four timers in one effect ran thinking moves, lean-ins, resting
glances and the dance, sharing loose fields, so one had to be told by hand to win over another. The eyes changed in
three ways that couldn't blend: springs moved where they looked, Web Animations played expressions and blinks, and a
CSS class swapped in the happy eyes. Adding a move meant more timer code, and the only way to look at one was a
throwaway page and a strip of screenshots.

## Decision

- **An engine with no DOM** (`engine.ts`). A rig holds a Sprocket's springs and what it's doing; `advance(rig, now,
  pointer)` moves it to a time and returns what to draw and, when nothing moves, how long it can sleep. It has no
  timers and takes its random numbers from outside, so tests replay it frame by frame. Layers, from the bottom: the
  stance (or the pointer when following it), one gesture at a time, leaning in on its own clock (its glance leads
  over a gesture's turn), and the face (an expression, a blink, happy eyes), each on its own clock.
- **An activity instead of flags.** `activity` is `idle`, `think`, `write` (the spin) or `cheer` (happy eyes and a
  dance); `stance`, `follow` and `still` stay. The director in the engine picks what plays from it.
- **Clips as data** (`clips.ts`): gestures are lists of timed steps (turn, tip, roll, where the eyes look, kicks to hop
  and squash, a spin, an expression), lean-ins are lists of nearness and time, expressions are keyframes of each eye's
  shape, and the blink is a curve. A new move is a new entry, not more timer code. A move whose parts have to land
  together (squashing the moment it touches down) is keyframed tracks instead (`Moves`: hop, squash, tip, each key
  easing in, out or both), played straight off its animation's clock on top of the pose; kicks to free springs drift
  apart and read as jerky. Satisfied's nod and Cheer's dance are built this way, on the same timing (each hop floats, each landing is a quick squash straight into the next, and a slow wobble ends it).
- **Finished animations, apart from their parts** (`animations.ts`): the polished set a Sprocket plays, each naming
  when it plays, how long it lasts, its gesture or moves and its eyes (Cheer, Survey for starting a reply in a team, and Satisfied). Every one shares the same blinks (none while the eyes are ^ ^, which are already shut),
  expressions and leaning in, so a Sprocket behaves predictably wherever it is; what's decided per animation is
  when it plays. Each plays once, for a set time, then the Sprocket goes back to resting, whatever its activity. The parts in `clips.ts` are what they're built from.
- **Eyes drawn from numbers.** Each frame gives each eye a shape (moved and sized), how shut its lid is and how happy
  it is; `Sprocket.tsx` paints them. The happy arc grows in as the open eye squashes away, so it can blend.
- **One loop, one clock** (`motion.ts`): a single requestAnimationFrame loop runs every moving rig and sleeps until
  the next thing one has planned. Its clock can be slowed, paused and stepped.
- **A lab in dev builds** (`#/lab`, `SprocketLab.tsx`, left out of production builds): any character or all of them,
  any stance and activity, any gesture, expression, blink or lean-in on cue, a pose held with sliders, and the clock
  slowed, paused or stepped a frame at a time.

## Consequences

- The look and timings are those of ADR 0005's amendments; this changes how they're built, not what they are.
- Reduced motion is one input (`faceOnly`): the pose holds and only blinks and happy eyes move, as before.
- A new animation is an entry in `animations.ts` built from parts in `clips.ts`, checked in the lab, whose
  Animations section lists only the finished ones.

## Amendment (2026-10-25): idle and activity animations

Animations come in two kinds (`kind` in `animations.ts`), after watching a Grok bot live (its clip table and
frames; numbers are Grok's, Rails' animations use their own values):

- **Idle**: played now and then while a Sprocket rests (Breathe, Look around, Daydream, Doze, Hum, Stretch).
  Given a list (`setIdles`), a resting rig plays them on a Grok bot's timing: a beat to settle first
  (`IDLE_FIRST`, 1.5–3 s), then one straight after another with half a second still between (`IDLE_GAP`),
  weighted (Breathe most), the rarer ones never twice running; anything to do stops them at once.
- **Activity**, at one of two moments (`moment`): in flight, while it thinks or types (Stream, Focus, Idea, Inspect,
  Rummage, Survey, and the dots), and done, only once it has finished typing: celebrating mostly (Cheer, Satisfied,
  Notify, Hooray, Twirl), or finishing stuck or failed (Puzzled, Droop). What differs is the chat, as a Grok bot's:
  - In a direct chat the icon by a reply in flight and the Sprocket's row are one drawing (`<use>` of the row's
    SVG, its `id`), so they move exactly alike, and while it thinks it becomes an ellipsis: its outline splits into
    three bouncing dots and back (`dots` on `Sprocket`, `toDots` and `dotsAt` in `morph.ts`). Once it's done the
    icon goes, and the row, being the same drawing, is where it celebrates.
  - In a team chat the thinking icon is its own Sprocket, going through the members, apart from their rows, and
    never dots. Once the replies land it goes; the team's own picture is still, so nothing is left to celebrate.

Moves gained `near`, `lookY`, held faces (`eyes`: named shapes in `FACES`, blending over `FACE_MS`) and their own
`blinks`: while an animation with moves plays, those are its only blinks, so a blink never lands on a face it
didn't plan for. The new animations are in the lab only (its Idle and Activity groups, a switch to idle now and
then, the dots, and a panel playing a reply in a direct and in a team chat); where each plays in the app is still
to decide.

## Amendment (2026-10-25, later): in the app

- A Sprocket's row in the list (`SprocketsPage.tsx`) plays them. In flight: surveying in a team; otherwise the
  dots while it thinks, Inspect or Rummage at each tool step and Stream as it types (`flight.ts`, from the socket's
  `sprockets.typing` and `sprockets.activity`). Done: by how it ended (`doneFor`). Idle: for two minutes after it
  last worked (`IDLE_FOR`); still before it has worked since the page opened, and after.
- A direct or project chat's icon by a reply in flight is that row's drawing (`<use href>` of its `id`); the typing
  pill with dots and the spin are gone. Where the list isn't on screen the icon is a Sprocket of its own driven the
  same way.
- A team chat no longer cheers beside a member's new message; the face there stays still.
- `Sprocket` takes `play` (an animation by name, once per key) and `idles`.

## Amendment (2026-10-25, later still): resting rows

A Grok bot's row rests in a still pose until it has something you haven't seen. Measured in Grok Bot 0.75.8: after
a launch every row is still; once a bot's reply lands, its row plays its done animation and then idles with no end
(23 cycles over 90 s, and on for minutes with its DM open the whole time) until you select its row, by opening its
DM or clicking the row while the DM is open. Moving the pointer or clicking inside the chat doesn't count. 1.2 to
2.2 s after the selection it settles into its resting pose and stops, and it stays still after you leave.

Rails' rows do the same (`resting` on `Sprocket`, `setResting` in `engine.ts`, `useSeen` in `SprocketsPage.tsx`).
A row starts out resting, holding the pose it has beside its messages (`REST_POSE`, its resting pose, `rest`; ADR 0005's amendment of 2026-10-25), with no blinks or
glances, so the loop sleeps. Its newest message changing, or its work ending, makes the reply unseen: it idles
until you select it, then no new idle animation starts, and 1.4 s later (`SEEN_AFTER`) it rests once what's playing
is over, so it settles in about 3 to 5 s. Resting never cuts an animation short. Following the pointer wakes it;
keyboard focus turns it to face you, and a click's focus doesn't. The two-minute idle window this replaces is gone,
and an open chat's row no longer faces you.

## Amendment (2026-10-25, later still): the spawn

A Sprocket just made gathers itself, as a Grok bot does (its `spawning` state, the `gather` morph, 2 s): its body
shrinks into a seed, five specks spiral in round it, and it grows back into itself. Like the dots, it's a drawing
(`toSeed`, `specksAt` in `morph.ts`) the rig paints while it faces you, not a clip: the engine's poses and timings are
unchanged. `spawn.ts` marks a Sprocket made on this device (the creator does, as the server returns it) for the
spawn's length, and its list row plays it; its direct chat shows the icon by a reply in flight from that moment,
mirroring the row, so the spawn plays where its first message will be. Without a model its hello (a template) waits
out the spawn on the server (`INTRO_PAUSE_MS`). Other devices see it arrive without the spawn, which is cosmetic.

