# Gearworks Defense: brief

A steampunk tower-defense game for the browser. Plain JavaScript ES modules and Canvas 2D: no
dependencies, no frameworks, no build step, no image or audio files. It's served as static files at
http://localhost:5190/ (that server is already running: don't start another one).

## Gameplay

- One map: a winding path on a 20 × 12 tile grid of 48 px tiles (a 960 × 576 canvas). Enemies enter at one
  edge and walk the path to the Core at the other end.
- An enemy that reaches the Core costs lives (20 to start; a boss costs 5). At 0 lives the game is lost.
- 10 waves. The player starts each wave with a "Next wave" button (an early start gives bonus gold).
  Wave 10 ends with a boss; clearing it wins the game.
- Enemy types: **Scuttler** (fast, weak), **Brute** (slow, tanky), **Swarm** (tiny, in groups of 6),
  **Boss** (huge health, slow). Health grows with the wave number.
- Tower types, placed on any tile that isn't path:
  - **Gear Gun** (cheap, single target, fast fire)
  - **Steam Mortar** (slow, splash damage)
  - **Tesla Coil** (chains between up to 3 enemies)
  - **Frost Vent** (no damage, slows enemies in range)
  Each tower can be upgraded twice (more damage and range) and sold for 70% of what was spent on it.
- Gold: 150 to start, plus gold per kill and a bonus per cleared wave.
- Speed control (1× / 2×) and pause.

## Screens and UI

- Title screen: "Play" and "How to play".
- In game: a HUD (gold, lives, wave n/10, Next wave, speed, pause, mute), a tower shop (cost, and
  greyed out when unaffordable), and a panel for the selected tower (level, Upgrade with its cost, Sell
  with its value, its range shown as a circle on the map). Hovering a tile while placing shows whether the
  tower can go there.
- Pause, victory and game-over screens with the score (kills, waves, lives left) and the best score kept
  in localStorage.
- Sound effects synthesised with WebAudio (shot, hit, explosion, enemy killed, leak, wave start, win,
  lose), with a mute toggle that's remembered.
- Art drawn with canvas shapes: brass, copper and dark teal; gears on the towers; readable at a glance.

## Architecture and who owns what

| Path | Owner | What |
| --- | --- | --- |
| `index.html`, `styles.css`, `src/main.js` | engine (Claude Code) | page, boot, wiring |
| `src/engine/` | engine (Claude Code) | `loop.js` (fixed 60 Hz update + render), `input.js` (mouse and keys), `renderer.js` (canvas helpers), `scenes.js` (scene stack: title, play, pause, end), `events.js` (event bus) |
| `src/game/` | gameplay (Codex) | `state.js`, `map.js`, `enemies.js`, `waves.js`, `towers.js`, `projectiles.js`, `economy.js` |
| `src/ui/` | UI (pi) | `hud.js`, `shop.js`, `menus.js`, `audio.js`, `storage.js` |
| `tests/` | each owner, one file per module | `node --test` unit tests of pure logic |

## Contracts

- `src/engine/events.js`: `on(name, fn)` (returns an unsubscribe function), `off(name, fn)`, `emit(name, data)`.
- `src/game/state.js`: `createState()` returns one plain object: `{ gold, lives, wave, waveActive,
  enemies: [], towers: [], projectiles: [], speed: 1, paused: false, muted: false,
  status: "title" | "playing" | "won" | "lost", selectedTowerId: null, placing: null, score: { kills: 0 } }`.
- Game logic doesn't touch the DOM: each game module exports `update(state, dt)` and, where it draws,
  `render(ctx, state)`. The UI draws on the same canvas (`render(ctx, state)`) and reads clicks through
  the engine's input.
- Events: `enemy:killed`, `enemy:leaked`, `tower:placed`, `tower:upgraded`, `tower:sold`,
  `wave:started`, `wave:cleared`, `game:won`, `game:lost`, plus `ui:*` events the UI sends (for example
  `ui:place-tower {type, col, row}`, `ui:upgrade {towerId}`, `ui:sell {towerId}`, `ui:next-wave`,
  `ui:speed`, `ui:pause`, `ui:mute`).

## Rules for every session

- Work in the files you own. For shared files (`src/main.js`, `index.html`, `src/game/state.js`,
  `src/engine/events.js`) make small, additive changes, and say what you changed.
- Don't commit: I commit at milestones.
- Don't start servers. Check your work with `node --check <file>` and `node --test tests/`.
- When you finish a step, end with a short summary of what's done and what others can now use.
