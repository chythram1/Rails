# ADR 0017: Light and dark themes

Status: accepted (replaces DESIGN.md's dark-only "Quiet Control Room").

Rails was dark only. The visual overhaul (DESIGN.md, "The Ruled Console") brings a light theme too, and with it a choice that has to work on every device a user opens Rails on.

Decisions:
- **Three choices: Light, Dark and System.** System follows the device's appearance, live, and is where every
  browser starts. It's a choice, not a third palette: it resolves to light or dark (`theme.ts`).
- **Each browser keeps its own choice** (`localStorage`, `rails.appearance`). Devices differ (a phone in daylight,
  a desktop at night), so it isn't part of the Profile, which every device shares, and nothing about it reaches
  the server. If storage is blocked, the page still switches until it's reloaded.
- **Applied before the first paint.** A small script in `index.html` sets `data-theme` on `<html>` from the saved
  choice or the device, so a light page never flashes dark; `theme.ts` keeps it current. Without either, the
  stylesheet falls back to dark.
- **Two palettes, one set of names.** Every color token has a value in each theme (`styles.css`), and components
  use only the tokens, so a theme change is a change of variables: no remounting, and terminals, layouts and
  drafts stay as they are. DESIGN.md's front matter mirrors both palettes, and `design.test.ts` checks them.
- **Terminals stay dark in both themes.** Claude Code, Codex and pi pick colors meant for a dark background, and
  Rails never changes their settings (it would have to write the user's agent settings files, which it doesn't).
  So a terminal is a dark work region inside a light frame; the tab strips above it follow the theme.

Considered: storing the choice with the Profile (one choice for every device, but it isn't one: what suits a
phone outdoors doesn't suit a desktop at night); terminals that follow the theme (closer to the reference, but
agents' dim text and highlights become hard to read until the user changes each agent's own theme); a separate
Terminal setting (more to explain, for a case no one has asked for yet).
