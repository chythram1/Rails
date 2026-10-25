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
