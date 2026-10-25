---
version: alpha
name: Rails
description: A square, ruled console around the terminals of Claude Code, Codex and pi, in a light and a dark theme.
colors:
  bg: "#1d1d1d"
  sidebar: "#141414"
  surface: "#1d1d1d"
  surface-2: "#262626"
  hover: "#2c2c2c"
  dialog: "#000000"
  field: "#262626"
  btn: "#2e2e2e"
  border: "#333333"
  border-strong: "#4d4d4d"
  border-field: "#636363"
  border-focus: "#babab5"
  text: "#f8f8f3"
  text-2: "#d8d8d1"
  muted: "#a6a6a1"
  primary: "#f8f8f3"
  on-primary: "#171717"
  primary-hover: "#ffffff"
  blue: "#6da5f4"
  tint: "#2a3040"
  tint-ink: "#c8d5ec"
  pink: "#f08cd7"
  pink-tint: "#2f2328"
  green: "#8fcf6b"
  green-tint: "#1b301e"
  green-ink: "#c5e4c7"
  amber: "#e3b341"
  red: "#f0605a"
  idle: "#6b6b6b"
  diff-add: "#1c2e1f"
  diff-add-ink: "#a8dcae"
  diff-del: "#3a2222"
  diff-del-ink: "#f2a3a0"
  term-bg: "#1d1d1d"
  light-bg: "#ffffff"
  light-sidebar: "#fafafa"
  light-surface: "#ffffff"
  light-surface-2: "#f0f0f0"
  light-hover: "#f4f4f4"
  light-dialog: "#fafafa"
  light-field: "#ffffff"
  light-btn: "#ffffff"
  light-border: "#e8e8e8"
  light-border-strong: "#d4d4d4"
  light-border-field: "#a0a0a0"
  light-border-focus: "#171717"
  light-text: "#171717"
  light-text-2: "#444444"
  light-muted: "#6b6b6b"
  light-primary: "#171717"
  light-on-primary: "#ffffff"
  light-primary-hover: "#333333"
  light-blue: "#3065e4"
  light-tint: "#e2e8f8"
  light-tint-ink: "#3c4a64"
  light-pink: "#b0428f"
  light-pink-tint: "#f7eef2"
  light-green: "#3f8f2b"
  light-green-tint: "#c5e4c7"
  light-green-ink: "#346218"
  light-amber: "#9a6200"
  light-red: "#c4372f"
  light-idle: "#a3a3a3"
  light-diff-add: "#e7f4e8"
  light-diff-add-ink: "#1f6b2a"
  light-diff-del: "#fbeaea"
  light-diff-del-ink: "#a8322b"
  light-term-bg: "#1d1d1d"
typography:
  display-xl:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.02
    letterSpacing: -0.04em
  display:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.025em
  title:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  title-sm:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  caps:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 11.5px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.08em
  eyebrow:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.06em
  wordmark:
    fontFamily: "Space Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0.04em
  name:
    fontFamily: "Space Grotesk Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.3
  code:
    fontFamily: "Space Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.6
rounded:
  none: 0px
  row: 6px
  pill: 999px
spacing:
  2xs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 40px
components:
  canvas:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text-2}"
    typography: "{typography.ui}"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
  row-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.row}"
  menu-item-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.muted}"
  dialog:
    backgroundColor: "{colors.dialog}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: 8px 12px
  button:
    backgroundColor: "{colors.btn}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: 7px 16px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.ui}"
    rounded: "{rounded.none}"
    padding: 7px 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  rule:
    backgroundColor: "{colors.border}"
    height: 1px
  edge:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  field-edge:
    backgroundColor: "{colors.border-field}"
    height: 1px
  field-focus:
    backgroundColor: "{colors.border-focus}"
    height: 1px
  link:
    textColor: "{colors.blue}"
  nav-hover:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.tint-ink}"
    rounded: "{rounded.row}"
  suggestion-head:
    backgroundColor: "{colors.pink-tint}"
    textColor: "{colors.pink}"
    typography: "{typography.eyebrow}"
  tag-connected:
    backgroundColor: "{colors.green-tint}"
    textColor: "{colors.green-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
  status-live:
    textColor: "{colors.green}"
  status-busy:
    textColor: "{colors.amber}"
  status-attention:
    textColor: "{colors.red}"
  status-idle:
    textColor: "{colors.idle}"
  diff-added:
    backgroundColor: "{colors.diff-add}"
    textColor: "{colors.diff-add-ink}"
    typography: "{typography.code}"
  diff-deleted:
    backgroundColor: "{colors.diff-del}"
    textColor: "{colors.diff-del-ink}"
    typography: "{typography.code}"
  terminal:
    backgroundColor: "{colors.term-bg}"
  canvas-light:
    backgroundColor: "{colors.light-bg}"
    textColor: "{colors.light-text}"
  sidebar-light:
    backgroundColor: "{colors.light-sidebar}"
    textColor: "{colors.light-text-2}"
  menu-light:
    backgroundColor: "{colors.light-surface}"
    textColor: "{colors.light-text}"
  row-selected-light:
    backgroundColor: "{colors.light-surface-2}"
    textColor: "{colors.light-text}"
  menu-item-hover-light:
    backgroundColor: "{colors.light-hover}"
    textColor: "{colors.light-muted}"
  dialog-light:
    backgroundColor: "{colors.light-dialog}"
    textColor: "{colors.light-text}"
  input-light:
    backgroundColor: "{colors.light-field}"
    textColor: "{colors.light-text}"
  button-light:
    backgroundColor: "{colors.light-btn}"
    textColor: "{colors.light-text}"
  button-primary-light:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.light-on-primary}"
  button-primary-hover-light:
    backgroundColor: "{colors.light-primary-hover}"
    textColor: "{colors.light-on-primary}"
  rule-light:
    backgroundColor: "{colors.light-border}"
  edge-light:
    backgroundColor: "{colors.light-border-strong}"
  field-edge-light:
    backgroundColor: "{colors.light-border-field}"
  field-focus-light:
    backgroundColor: "{colors.light-border-focus}"
  link-light:
    textColor: "{colors.light-blue}"
  nav-hover-light:
    backgroundColor: "{colors.light-tint}"
    textColor: "{colors.light-tint-ink}"
  suggestion-head-light:
    backgroundColor: "{colors.light-pink-tint}"
    textColor: "{colors.light-pink}"
  tag-connected-light:
    backgroundColor: "{colors.light-green-tint}"
    textColor: "{colors.light-green-ink}"
  status-live-light:
    textColor: "{colors.light-green}"
  status-busy-light:
    textColor: "{colors.light-amber}"
  status-attention-light:
    textColor: "{colors.light-red}"
  status-idle-light:
    textColor: "{colors.light-idle}"
  diff-added-light:
    backgroundColor: "{colors.light-diff-add}"
    textColor: "{colors.light-diff-add-ink}"
  diff-deleted-light:
    backgroundColor: "{colors.light-diff-del}"
    textColor: "{colors.light-diff-del-ink}"
  terminal-light:
    backgroundColor: "{colors.light-term-bg}"
---

# Design System: Rails

The tokens live in `packages/web/src/styles.css`, at the top: type and shape in `:root`, then the dark palette (`:root:not([data-theme="light"])`, the default) and the light one (`:root[data-theme="light"]`), with the same names. That file is the source of truth: the colors in the front matter above mirror both palettes (light ones prefixed `light-`), and `packages/web/src/design.test.ts` fails if they drift. Use the CSS variables (`var(--surface)`), never the hex values. Reference screenshots are in `scratch/visual-overhaul/` (local only); themes are ADR 0017.

## Overview

**Creative North Star: "The Ruled Console"**

Rails is where someone watches and steers several coding agents at once. The terminals are the work; around them is a console of square, ruled regions, set like a technical document: big tight headlines, small capitals over columns, mono for anything a machine would print. Lines do the structuring, not boxes or shadows. Color is rare and always means something: blue is the hand (what you can act on), pink is the Sprockets (what the coordination layer says), and green, amber and red are state.

It's an operate surface: dense, familiar and consistent from screen to screen, in a light and a dark theme. Personality lives in the type and in a few deliberate places, the Sprockets and the avatars.

**Key Characteristics:**
- Two palettes with the same token names: paper white and charcoal. Terminals stay dark in both.
- Square everything: fields, buttons, menus, dialogs, cards, the composer. Navigation rows are the one rounded rectangle (6px); dots, avatars, swatches and the switch are round.
- 1px rules between regions and rows; tabs and segments sit in ruled strips.
- Four type roles: Inter for text (its display cut for headlines), Space Grotesk for the wordmark and Sprocket names, Space Mono for small capitals and technical values, the system monospace in terminals.
- Flat: only floating layers (menus, dialogs) get a shadow. No motion in the chrome, except the logo: an armadillo that walks under the pointer and curls up into a ball when the sidebar collapses. The Sprockets are the one thing that moves on its own.

## Colors

Each token has a dark and a light value (front matter: `bg` and `light-bg`). Dark text is warm (`#f8f8f3`), light is neutral; the light theme's muted gray, pink and amber are dark enough to pass 4.5:1 for text.

### Primary
- **Ink Button** (`--primary`, text on it `--on-primary`): the one primary action in a view and the send block. Near-white on dark, near-black on light; `--primary-hover` on hover.

### Neutral
- **Canvas** (`--bg`): the page, chat, side panel, the shown tab.
- **Sidebar** (`--sidebar`): the sidebar, the dock's tab strips, the side panel's header.
- **Surface** (`--surface`): menus and popovers (their edge sets them apart).
- **Surface 2** (`--surface-2`): the selected row, the current page in the nav, user chat bubbles, gallery cards, insets.
- **Hover** (`--hover`): hover on actions: menu items, buttons, icon buttons, files.
- **Dialog** (`--dialog`): Settings, the avatar picker and Rename session (black on dark).
- **Field** (`--field`) and **Button** (`--btn`): the fill of inputs and of default buttons.
- **Rule** (`--border`): between regions and rows. **Edge** (`--border-strong`): floating layers, cards, buttons, the composer. **Field Edge** (`--border-field`): inputs. **Field Focus** (`--border-focus`): a field's edge while focused or open.
- **Ink** (`--text`), **Soft Ink** (`--text-2`, navigation, field labels, inactive tabs) and **Muted** (`--muted`, secondary text and every placeholder).
- **Terminal** (`--term-bg`): the same charcoal in both themes; `TerminalView.tsx`'s xterm theme matches it.

### Accents
- **Blue** (`--blue`): links (underlined), keyboard focus rings, the drop target in the dock, diff hunk headers.
- **Tint** (`--tint`, ink on it `--tint-ink`): hover on navigation (sidebar rows, Settings sections, the Sprocket list, gallery cards), the chosen segment and creator thumbnail, a row reached from Settings search. `--tint-ink` also underlines the shown tab in the focused pane.
- **Pink** (`--pink`, band `--pink-tint`): the Sprockets. The head of a suggested reply ("REPLY TO" in Space Mono), the left edge of handoff and owner rows, the check on a sent suggestion.

### State
- **Live** (`--green`, tag `--green-tint` with `--green-ink`): an open panel's session dot, a connected provider's tag, the switch when on, added files.
- **Working** (`--amber`): busy agents, reconnecting, modified files, overlap marks.
- **Needs you** (`--red`): attention dots, errors, destructive actions, deleted files.
- **Idle** (`--idle`): a session that isn't open, the switch when off.
- **Diff** (`--diff-add` / `--diff-add-ink`, `--diff-del` / `--diff-del-ink`): added and deleted lines.

**The Three Hues Rule.** Blue is interaction, pink is the Sprockets, green, amber and red are state. A hue never decorates, and none of them stands in for another: a Sprocket's reply that needs you is still red, a link inside a suggestion is still blue. The agents' own logos (`ProviderIcon`) keep their brand colors because they identify the agent.

**The Two Palettes Rule.** The pastel palettes of the Sprockets (`sprockets/characters.ts`) and the avatars (`assets/avatars/`) belong to those characters. They never color chrome, and they're the same in both themes.

**Deliberate one-offs.** A few literals stay out of the tokens on purpose: the Sprockets' ground shadow (`#000`, at `--sprocket-shadow`: lighter on a light page), the switch's white knob, the avatar's edit overlay (`rgb(0 0 0 / 0.5)` with a white pencil), and the black backdrops listed under Elevation & Depth.

## Typography

**Text:** Inter (`var(--font)`, `@fontsource-variable/inter`, its optical-size axis: `font-optical-sizing` gives headlines the display cut).
**Grotesk:** Space Grotesk (`var(--grotesk)`): the "RAILS" wordmark and Sprocket names.
**Mono:** Space Mono (`var(--mono)`, 400 only): small capitals (eyebrows), day stamps, menu shortcuts, rule numbers, and technical values: addresses, versions, paths, file lists, diffs.
**Terminals** use the system monospace on purpose, for glyph coverage. All fonts are bundled; never load fonts from a CDN.

### Hierarchy
- **Display XL** (600, 56px/1.02, -0.04em): the Home headline only; 38px on phones.
- **Display** (600, 36px, -0.03em): page titles, the sign-in title.
- **Headline** (600, 28px, -0.025em): the Settings section's title; 24px on phones.
- **Title** (600, 18px): dialog titles. A Sprocket's greeting is 24px Space Grotesk.
- **Title small** (600, 15px): pane headers (a Sprocket's name, "Settings" in its panel).
- **Body** (400, 15px/1.5): the page default and chat messages. The Home composer's text is 17px.
- **UI** (400, 14px): controls, rows, menus, fields; 500 for a setting's name, a project's name when open and the account name.
- **Label** (400, 13px): secondary lines, help text, tabs, field labels (`--text-2`), small buttons.
- **Caption** (400, 12px): timestamps, message details.
- **Caps** (600, 11.5px, +0.08em, uppercase, `--muted`): headings over columns and groups: "PROJECTS", the Sprocket list's groups, Settings groups (on a rule), menu headings.
- **Eyebrow** (Space Mono 12px, +0.06em, uppercase, `--muted`): a label over a headline or a dialog ("NEW CHAT", "× SETTINGS"), and the suggestion head's "REPLY TO" (11px, pink). Day stamps are the same at 11px.
- **Wordmark** (Space Grotesk 700, 15px, +0.04em, uppercase): "RAILS" beside the logo.
- **Name** (Space Grotesk 600, 17px): a Sprocket's name on its gallery card.
- **Code** (Space Mono 12.5px; 11.5–12px in lists and diffs): technical values.

**The Natural Case Rule.** Capitals are for the two small label styles only. Names, messages, buttons, menu items and user data stay in natural case. Times and counts use `font-variant-numeric: tabular-nums`.

## Layout

The app is a shell: a resizable sidebar (300px by default) and a main area. Workspaces are dockview panes that share 1px rules, with 36px tab strips. Page headers are 52px tall. Content columns cap their width: pages 1080px, Home 880px (its headline and composer on the column's left edge), chat messages 760px, the chat composer 800px, Settings 900 × 680px.

Spacing runs on 4px steps (`spacing` above) with 2px half-steps (6, 10, 14px) for tight rows and controls: 4–8px inside a group, 12–16px between groups, 24–40px between sections (Settings groups sit 36px apart). Rows are 38px in the sidebar nav and about 35px for sessions.

- **The Icon Column Rule.** Sidebar icons sit on one vertical line (`--icon-x`) in both the expanded sidebar and the collapsed rail, so collapsing never moves an icon.
- **The Shell Holds Rule.** At 860px and below, the sidebar becomes a drawer, the workspace shows one panel at a time, Settings fills the screen and the Sprockets page shows either the list or a chat. Component-level changes use container queries (the Sprocket settings panel overlays the chat when its container is under 720px).
- **The Shared Rule.** Neighbouring regions share one 1px rule: never a gap and two edges.
- Hover styles live inside `@media (hover: hover)`, so a tap never leaves a row lit.

## Elevation & Depth

Depth comes from rules and tone, not shadow: regions are divided by 1px `--border` rules, raised things get a 1px `--border-strong` edge, and inline things (rows, cards, panels, the composer) have no shadow.

### Shadow Vocabulary
- **Popover** (`--shadow-pop`: `0 12px 32px rgb(0 0 0 / 0.5)` dark, `0 8px 24px rgb(0 0 0 / 0.08)` light): menus, dropdown lists, dialogs, the jump button, the Sprocket settings panel when it lies over the chat.
- **Backdrop:** `rgb(0 0 0 / 0.5)` behind Settings and the mobile drawer, `0.4` behind the avatar picker and Rename session.

**The Edge Rule.** A floating layer always has its 1px edge as well as its shadow; nothing in the page flow gets a shadow.

## Shapes

Square by default (`rounded.none`): fields, buttons, icon buttons, menus and their items, dropdowns, dialogs, the composer and its send block, cards, gallery cells, suggestion cards, rule and handoff rows, chat bubbles, tags, tab strips, segments, thumbnails.

- **6px** (`rounded.row`, `--row-r`): navigation rows only: sidebar nav items, projects, sessions, the account row, Settings sections and search results, the Sprocket list's rows.
- **Circles and pills** (`rounded.pill`): status dots, avatars, colour swatches, and the switch.
- The Sprocket characters keep their own soft shapes, and the logo is built from round-ended bars: against the square frame they're the softest things on screen.

## Components

### Buttons
- **Default:** `--btn` fill, 1px `--border-strong`, square, 7px × 16px, 14px/500; hover fills `--hover`. **Small:** 4px × 12px, 13px.
- **Primary:** the Ink Button (`--primary`, `--on-primary` text). One per view; disabled at half opacity (it reads gray).
- **Danger:** red text on the default button; never a red fill.
- **Icon buttons:** 30px square, `--muted` icon that turns `--text` with a `--hover` fill on hover; `--surface-2` while pressed or open. Icon-only buttons always have an `aria-label`.

### Inputs / Fields
- **Style:** `--field` fill, 1px `--border-field`, square, 8px × 12px, 14px. Labels above in 13px `--text-2`.
- **Focus:** the edge turns `--border-focus`; no glow. Everything else focusable shows the 2px blue ring.
- **Placeholder:** `--muted`. **Disabled:** 0.5–0.6 opacity.

### Segmented control
- **Segmented** (`components/ui/Segmented.tsx`) for a choice of two to four: square segments in one box with a 1px `--border-strong` edge and rules between them, 13px with a 15px icon; the chosen one in `--tint` with `--tint-ink`, others turn `--hover` on hover. Native radios underneath, so Tab reaches the group and the arrow keys move the choice. **Appearance** (Settings → General: Light, Dark, System) is the first.

### Dropdowns and menus
- **Dropdown** (`components/ui/Dropdown.tsx`) replaces every native `<select>`: a field-like trigger with a chevron, a list in a menu, a check on the chosen option (which also has the `--surface-2` fill), group headings in Caps, optional icons (agent logos), disabled options, and a search field (on a rule) from 10 options up. The **plain** variant drops the field look for pickers in a ruled footer (the Home composer's project and agent): `--text-2` 13px, full height, a rule on its right, `--hover` on hover and `--surface-2` while open.
- **Menus** (`MenuButton` / `usePopover` in `components/ui/Menu.tsx`): `--surface`, 1px `--border-strong`, square, no padding: full-width 36px rows with 14px side padding, 16px Tabler icons, rules between sections, Caps headings, red for destructive items, shortcuts right-aligned in 11px Space Mono. Keyboard focus fills the row and draws a 2px blue bar on its left. A menu of choices marks the current one with a check on the right.

### Switches
- **Switch** (`components/ui/Switch.tsx`) for a setting that applies at once: a 36 × 20 pill with a white 16px knob, `--idle` when off (darker on hover), `--green` when on. No slide. It sits on the right of its row, its label and a one-line description on the left; a `button` with `role="switch"`, named by its `<label>`.

### The Sprocket list
- **Grouped by project** (`sprockets/groups.ts`): first **Teams** (team chats, ADR 0022, the most recently active first), then Caps headings with the project's name, in the sidebar's order, then **General** for unattached Sprockets. In a group the Coordinator comes first, then the most recently active. Each Sprocket is one row (a 6px navigation row): the 50px character (its box's empty top overlapping the row's padding, so the row stays about 53px), the name (500), the time on the right (none while its chats are empty), then the last line of the newer of its chats and the red attention dot while a reply waits in either. An attached Sprocket's row opens its project chat (ADR 0021); its direct chat is a tab away in the chat header. A group's row (`GroupFace.tsx`) puts its members' characters in that 36px box, the lead in front at the bottom (two overlap corner to corner, three stand in a triangle, four in a square), and its last line names who wrote it. Selected: `--surface-2`; hover: `--tint`.
- **Characters in the list rest** (`resting`), holding the pose they have beside their messages: a list of moving faces is too busy, and a team's row holds several. A Sprocket's own row comes alive while the pointer is on it, following the pointer; while it has focus, facing you; while it works on a reply in any of its chats (from 0.8–1.3s after it starts, each row a little apart, as if taking a moment to notice), surveying in a team and otherwise as the icon by its reply (dots, inspecting, rummaging, streaming); and once its reply is done, the done animation for how it ended (`doneFor` in `animations.ts`): a question or a card to act on, Notify; stopped at a cap, Puzzled; failed, Droop; otherwise Cheer, Satisfied or Hooray, and now and then Twirl, the same each time for the same message. Then it idles (Breathe most, Look around, Daydream, Doze, Hum, Stretch, half a second apart) until you've seen the reply, however long that takes: selecting its row (opening its chat, or clicking it while the chat is open) makes it rest 1.4 s later, once what's playing is over. Having the chat open as the reply lands doesn't count. Resting, it holds the pose it has beside its messages (its resting pose: turned 33°, tipped up 16°, rolled 25° to the left), still and not blinking. A row rests from the start too. Hovering wakes it (it follows the pointer, then settles back). It turns back before it stands still again (700ms). A team's row always stands still. The gallery, the chats and the creator keep their motion.
- **Filter**, always there so nothing shifts when a second group appears: a 36px ruled strip under the search (which keeps the header to itself) with a plain menu button named after what the list shows: a 14px filter icon, "All Sprockets" or the group's name, a chevron; 13px `--text-2`, `--text`/500 while a group is chosen, `--hover` on hover. Its menu: All Sprockets, then each project with Sprockets and General, the current one checked.
- **One New button**, an icon button (a pen on a square) beside the search, makes either: its menu has New Sprocket and New team (disabled, "Needs two Sprockets", until there are two). It's the way in on phones, which have no gallery; the gallery keeps its New card for Sprockets only.
- **Gallery** (desktop, nothing open): square `--surface-2` cards in a grid, 12px apart, in the order the Sprockets were made, so nothing moves when they're active or moved. Each card: the 84px character top left, the name in Space Grotesk, the chat's last line in muted 13px; `--tint` on hover. The New card is last: an outlined peer (1px `--border-strong`, transparent) laid out like the others, so its lines meet theirs: in a character's frame (the same 84px box and ground shadow) a round-ended plus in `--muted` stands where a body would, then "New Sprocket" and a muted "Pick a look and a name". On hover its edge and plus turn `--tint-ink`.

### Customize
- **A page of cards with its tabs beside it** (`components/customize/CustomizePage.tsx`): a 184px column on the left (`PageNav.tsx`, which Automate shares) with "Customize" (14px 500, `--text-2`) over the tabs Connectors · Skills · Prompts as navigation rows (6px, an 18px icon, `--surface-2` and 500 for the current one, `--tint` on hover), sticky as the page scrolls. The page beside it (up to 1200px for both, 32px apart, 40px from the top) starts with the tab's own title (Space Grotesk 28px, -0.02em) 6px over one muted line on what it holds, and its one action at the right (default buttons, 36px tall: "Add custom server" with a menu for a URL or a command, "New skill", "New prompt"). Then, 20px under it, a 40px row: Yours · Discover (the Segmented control, 40px tall; not on Prompts) and the search filling the rest. Under 860px the tabs go above the title as a row; under 640px the search takes its own line. Coming back from an item keeps the tab's Yours or Discover.
- **Sections:** a 16px 600 heading with its muted count (and a muted 13px line beside it where one helps, as in Discover on Skills), 28px apart, each a grid of cards (340px minimum, so two columns beside the tabs, 12px gaps; one column on phones). Spacing stays tight on purpose: the page reads as one list, not separate panels.
- **Cards** are square `--surface-2` blocks with 16px padding, as the Sprockets gallery's: a 40px mark top left, then the name (16px 600, a link stretched over the whole card) over one muted 12.5px line, never more: in Discover how it connects ("Sign in", "Token", "No account"), in Yours its state ("4 tools", "Not connected yet", "Not signed in"), in the same muted grey: no red on cards. Then two lines of `--text-2` 13px on what it does (left out when there's none), and for a custom server its address or command in Space Mono 12px muted on one line (a connector's is in its dialog). No "by …" or Sprocket counts on cards: those are on its page. The dashed New skill and New prompt cards show only while their list is empty; the tab's button adds the rest. One action top right, above the link: a 30px "+" button (ruled, on `--surface`) or a check on a green wash for one that's connected (a connector is kept only once it's connected, so a card never shows one half added; should one be left anyway, say by leaving the page mid-sign-in, its "+" picks it up again instead of adding another). Hover: `--tint`. A card that adds something is dashed and transparent, the whole card one button.
- **Marks** (`ConnectorLogo.tsx`): a square tile, filled, the mark at half its side. A connector's brand mark (simple-icons, CC0, `logos.ts`, copied in) sits on its brand colour in white, or black when the colour is light (Supabase); a brand that's grey near black (GitHub, Notion, Vercel) gets a `--text` tile with the mark in `--bg`, so it stands out on either theme, while a dark colour (Atlassian's blue, Sentry's purple) keeps its colour. Connectors without a brand mark, custom servers (a plug for a URL, a terminal for a command), skills (a book), prompts (a message) and a project (a folder) get a Tabler icon in `--tint-ink` on `--tint`. Chips use the bare mark in its brand colour.
- **Discover** on Connectors: the catalog by group, headings only (Your accounts, Docs and knowledge, Google Workspace, On this computer), then Custom (two dashed cards: a server on the web, a program on this computer). On Skills: your agents' skills by the folder they were found in, then "Choose a folder…". Yours: your items as cards, then a dashed card to add more ("Browse connectors"; custom servers come from "Add custom server").
- **One item open** fills the page: a head on a rule with "‹ Connectors" (or Skills, Prompts) in muted 13px, the name after a slash for skills and prompts, and the actions at the right ("Test", "Use on Home", then Disconnect for a connector (a plain button: the confirm marks it as destructive), or the `…` menu with Remove for a custom server, or Delete). A server's editor starts with a hero: the 64px mark, the name in Space Grotesk 28px, "by …" muted, and its status line. A connector's editor puts sign-in (when it uses one) and its tools first; its address, name and headers fold under "Connection settings" at the end. A custom server keeps those first.
- **The editor is Settings rows** (`.set-group`, `.set-row`) at most 720px wide: choices save at once, one-line fields on blur, long texts with Save and Undo under them. A server's status is one 13px line: a 7px green dot and "Connected 2m ago", then muted "· 14 tools: 10 allowed, 4 ask first"; a red dot and what it needs ("Sign in to connect it."); or the error in red. Names, tool names, variable names and file paths are Space Mono 12.5px. "Sprockets with it" is a list of plain underlined links to their settings.
- **Adding a server is a dialog over the connectors** (`ServerDialogs.tsx`), not a page, so it feels as light as it is: 520px in the Dialogs' frame, a head (40px mark, the title in 18px 600, one muted line, × at the right), a body that scrolls on its own (head and actions stay), and actions at the foot (Cancel, then the primary). Fields are a 13px 500 label (with a muted "Optional") over the control and a muted 12.5px line under it. It opens on its first field, or on its primary action when it has none, never on ×. Escape, the backdrop and × close it and leave the page as it was.
  - **A connector** (a card's "+", or its card when it isn't added): what it does and how it connects, the one thing it needs (a token field with "Make one on …" under it, the folder picker, or "Set up your Google app" as its primary), its address or command in a Space Mono block on `--surface-2`, a line on where Sprockets' calls go, and "Setup guide ↗" at the foot's start. The primary says what happens: Connect, Choose a folder…, Add it.
  - **A custom server** ("Add custom server", the Custom cards): "Paste a config from its README" folded at the top (a mono textarea, Fill in), then Server type (a Dropdown: On the web, by its URL · A program on this computer), Name (optional; Rails picks one), the URL, or the command as one line with its arguments, and Headers or Environment as name and password rows. A value a pasted config left as a placeholder is empty with "Needs a value", and a muted line says which. Add server creates it and connects.
  - **Then the same dialog says how it went** (a connector isn't kept until it's connected: before that, its foot has Cancel instead of "Open its settings" and Done, and Cancel, ×, Escape or the backdrop remove it): a green dot and "Connected with 4 tools…", the sign-in under way (Open the sign-in page ↗, Cancel, and a field to paste the address it lands on from another device), a red dot and "Sign in to use its tools" with Sign in as the primary, or a red dot and why it can't connect with Try again. "Open its settings" at the foot's start, Done at its end. It follows a sign-in finished in another tab.
- **Something new** (`NewItem.tsx`: New skill, New prompt) opens as a draft, in the editor's head and rows ("‹ Skills / New skill"), with its first fields and Cancel and Create (primary, off until it has a name) at the end. Nothing is saved until Create; leaving drops it. Create opens it in its editor.
- **A service's shared app** (`AppSetup.tsx`, "Your Google app", reached from the Google Workspace section's link and from a Google connector's dialog, whose primary button is "Set up your Google app" until it is): the lead paragraph, a status line (7px dot, "Set up: client ID …" in mono, or "Not set up yet.") with its connectors in ruled rows (24px mark, name as a link, a muted state at the right), then numbered steps (mono numerals in `--muted`) whose links out end in a 13px external-link icon, the scopes and redirect address in the selectable `.cz-redirect` block, and the client ID and secret rows with Save (and Remove the app).
- **Secret values** (a server's environment and headers): a row per name with "Set" under it and Remove; a last row of two fields (name, then a password field for the value) and Add, or Replace for a name it has. Values never come back.
- **Sign-in** (a server with a URL): an Account row with the state (a 7px green dot and "Signed in", a red one and "It asks you to sign in", or "Not signed in") and Sign in (primary) when it isn't signed in, and Sign out for a custom server only. A connector's account is its connection, so it has no signed-out state: leaving it is Disconnect in the head (a confirm, then it's removed and back in Discover), and Sign in shows only when its sign-in expired ("Sign in again" on its card). While a sign-in runs, a `--surface-2` block under it: "Open the sign-in page" (primary, with an external-link icon) and Cancel, then the paste field and Continue for signing in from another device. Errors in red below. "Your own app" is a small disclosure (open when an app is set or needed): the redirect address whole in a selectable Space Mono block on `--surface-2`, then Client ID and a Client secret that, like other secrets, can be replaced but not read. The status line over the editor says a server needs a sign-in (red dot) instead of "Can't connect", and so does the list ("Sign in" in red).
- **Tools** come in two groups, "Can change things" then "Read-only" (as the server marks them). A group's head is its name (13px, 600) and muted count on a `--border-strong` rule, with a muted "All" and a small Allow · Ask · Off at the right that sets every tool in it (none chosen while they differ). Under it, ruled rows: the tool's name (Space Mono 12.5px) over its description (muted 13px, at most 2 lines, the whole in its tooltip), and the same small segmented control, lined up with the head's. The small segmented size (`small`) is 3px × 10px segments at 12.5px.

### Automate
- **Two tabs beside the page**, as Customize's (`PageNav.tsx`): Dashboard and Templates, each with its own title and muted line, and "+ New automation" (primary) at the right of both.
- **The Dashboard says how they're doing** (`components/automate/AutomatePage.tsx`). Then the overview: one ruled strip of four cells sharing 1px rules (two by two under 640px), each a 13px muted label with its 16px icon at the right, a 24px 600 value (tabular; 20px on phones) and a 12px muted note: Automations ("3 on"), Needs you (the icon red while any does; what it is, or "Nothing waits for you"), Runs ("85% without failing"), and Next run ("Today 6:15 PM", the automation's name). The overview shows even before there are any (zeros, "None"), with one muted line under it that links to the templates. Once there are some, a full-width search, then sections On and Off with their counts.
- **Cards** (two columns from 400px, one on phones) are `--surface-2` blocks with 16px padding: the name (16px 600, a link over the card) with Run now (an icon button with a play icon, disabled while a run goes) and a `…` menu (Turn off or on, Delete automation) at the right; two lines of its instructions in `--text-2`; a row of square tags (24px, `--surface` with a 1px rule, 12px `--text-2`, a 14px muted icon or the Sprocket's 16px face): the Sprocket, the schedule in words, the model; at the row's right its last 12 runs as 4 × 20px bars, oldest first, in their state's color (Nothing new and Skipped half height in `--idle`, slots not yet run in `--border-strong`), named for screen readers ("Last 12 runs: 11 done, 1 failed"). Under them the last run in an inset (`--surface`, 1px rule, 13px): its state's 16px icon in color, the outcome (500), its one line muted and cut to one line, the time at the right; "Paused" with Rails' reason in its place when Rails turned it off, or "No runs yet". Last, four numbers as a `<dl>`: Runs, Success (runs that ended without failing), Avg time, Next run ("Off" while off). With none yet, one dashed card makes the first, with an example.
- **Templates** (`Templates.tsx`, `templates.ts`): a row of filter chips (30px, ruled, each with its mark: All, Project, then every connector a template uses; the chosen one `--tint`), then starting points in sections (Your project, Issues and code, Errors and deploys, Your day), as Customize's cards: the mark (its connector's, a folder for the project, or the first two overlapping at 24px), the name over "Category · when it runs", what it tells you, and what it uses as chips with their marks. A use that's here says "✓ Connected" (or "Ready") in green; one that isn't is a dashed, muted chip: never red, since setting it up is part of starting one. A "+" sits top right. A card opens a new automation filled in from it, with the Sprocket that can do most of it chosen first; if the chosen one lacks something, a neutral note under its row (`--surface-2`, a 2px `--border-strong` rule at the start) says what and links to where to give it that, in a new tab so the draft stays.
- **One open, or a new one** (`AutomationEditor.tsx`, `NewAutomation.tsx`): Customize's head ("‹ Automate / Name", Run now and the `…` menu with Delete) and Settings rows. First a status line: a green dot and "On. Next run Mon, Oct 26, 09:00, your time.", a grey one and "Off.", or a red one and why Rails paused it. Then rows for On (a Switch), Name and Sprocket (a Dropdown with each one's face), the instructions with Save and Undo, the schedule, and the runs. A new one is a draft with the same fields and Cancel and Create at the end; Create goes back to the Dashboard, where its card is.
- **The schedule** (`ScheduleField.tsx`): a Segmented control (Once · Hourly · Daily · Weekdays · Weekly · Custom), then the fields that kind needs in a row: a date and time, a minute, the days (seven toggles in one ruled strip, chosen ones in `--tint`, Monday first), a time, or the cron in Space Mono with a muted line on its fields; the timezone (a searchable Dropdown) last. Under them the schedule in words and its timezone, muted. Changes wait for Save (with Undo); a refused one says why in red beside it.
- **Runs** are ruled rows, newest first: a 7px dot and the outcome (500): green Done, amber Running, red Needs you and Failed, grey Nothing new and Skipped — then the time and what started it ("Scheduled", "Run now") in muted, "In the chat" at the right, and the run's one line under it in `--text-2` (two lines at most).
- **In the chat** a run starts with a muted 13px line: a 14px clock, the automation's name (a link to it) and "on its schedule" or "run now". A run that found nothing new leaves no line.

### Lists of short texts
- **Rules** (a Coordinator's Rules tab, ADR 0011): one ruled list (a 1px `--border` above and between rows, no boxes) of numbered sentences: a muted 12px Space Mono number (two digits wide), the sentence in a borderless 14px textarea that grows with it, and a 26px remove button (14px X) that shows on hover or focus (always on touch screens). A row is `--hover` under the pointer and becomes a field only while edited (`--field` with a 1px `--border-focus` edge); Enter or leaving it saves, Escape puts it back. "Add" (a small button with a plus) sits at the right of the Rules heading and opens a new row at the end of the list, already a field: Enter adds the rule and leaves a fresh row for the next, Escape closes it. With no rules, the muted line under the heading ends with an example; at ten, Add is disabled and a muted line says that's the most. A rule's count shows at the row's right once it's within 40 characters of the limit.
- **Handoffs** (the Project tab, under the project, ADR 0015): square rows with a 1px `--border-strong` edge and a 2px pink left edge (the Coordinator's), a 13px `--text-2` route on top (the sending session's logo and short title, a muted arrow, the receiving session's) and the note under it in 14px, then the remove button, labelled "Cancel the handoff to …". With none waiting, a muted line says how to ask for one, with an example.
- **Owners** (the Project tab, under handoffs, ADR 0016): the same rows, with the session's logo and short title on top and its paths under it in 11.5px Space Mono, `--text-2`; the remove button is labelled "Remove what … owns". With none, a muted line says how to set them, with an example.
- **A handoff's attachment** (on its message card, ADR 0015): under the text, a collapsed native `<details>`, "Includes what … said when it finished", 13px muted with a 14px chevron (turned down while open); open, the words as a quote (2px `--border-strong` rule, 13px `--text-2`, pre-wrapped, scrolling past 12 lines). Sent cards keep it under the quote.
- **Usage** (a Sprocket's Settings page, under the model): one muted line, "12 replies · 312,400 tokens", with the cost after it when the provider reports one.

### Logs
- **Wake threshold** (Settings → Models, `settings/DecisionsSettings.tsx`, ADR 0013): a slider in the row's control column: a 4px `--border-strong` track filled up to a 14px square thumb (2px edge, `--surface` inside), then the value in 13px Space Mono (`--text-2`, tabular). The fill and the thumb's edge take the state colour of how risky the value is, with no words: green when safe, amber from 84% down, red below 80% (screen readers hear it in the value). A 1px `--muted` tick marks the default. With the decision model off it stays, in `--idle`, disabled. Focus shows as a 2px `--border-focus` ring around the thumb.
- **Recent decisions** (Settings → Models, `settings/DecisionsSettings.tsx`, ADR 0012, 0013): under the Decision model picker, a native `<details>`, collapsed: a 14px/500 summary with a muted chevron and the count. Open: a summary sentence in muted 13px, then a square list with a 1px `--border` edge (scrolls past 420px) with one row per judgment: the agent's logo, the session's title (500, truncated), "ended its turn" / "showed a dialog" and the time in muted 13px; the judged text quoted (2px `--border-strong` rule, `--text-2`, two lines at most); then the verdicts side by side at 13px ("Rails: …", "Model: … (91%)", "Coordinator: …", the model version, latency and cost in muted). Where the model and Rails differ, an amber "Differs" (a state color, with its word). Errors show in red. A judgment that woke the Coordinator says "Woke the Coordinator".

### Navigation
- **Sidebar:** the logo (below) and the RAILS wordmark, then 38px nav items with 18px icons and `--text-2` labels. The current page gets `--surface-2`; hover is `--tint` with `--tint-ink`, so a hovered row never looks selected, and the current page keeps its gray under the pointer (it's where you are, not somewhere to go). The same holds for the open session, the shown Settings section and the open Sprocket. "PROJECTS" in Caps.
- **Session rows:** status dot, title, provider logo, time (tabular). Dot colors: `--idle`, green live, amber working, red needs you, each with an `aria-label`. A row's ⋮ menu ("Rename…") takes the time's place on hover or keyboard focus, like a project row's; on touch screens it's always there, after the time. A named session's tooltip adds the agent's title in brackets.
- **Account row:** the profile's 28px avatar and name (500) with a chevron; an amber dot and "· Reconnecting…" only while the connection is down.

### Dialogs
- Native `<dialog>` (focus trap, Escape, inert page), `--dialog`, square, a 1px `--border-strong` edge and the Popover shadow. Escape and a backdrop click close only the topmost dialog.
- **Settings:** the left column starts with "× SETTINGS" (the close button and an Eyebrow), then the search field, then a tab per section (General, Providers, Models, Account) with a 17px icon: 6px rows, the chosen one `--surface-2` and 500. The right column starts with the section's title (Headline), then groups: a Caps heading on a rule, then rows. On phones it fills the screen: "× SETTINGS", search, then a single row of text-only tabs. A setting that needs another section links to it ("Connect a provider"), and focus moves to that section's tab.
- **Rename session** (`RenameSession.tsx`, ADR 0019): the avatar picker's frame at 440px: the title, one muted line, one field (filled and selected; the agent's title as its placeholder), an error under it, then Cancel and Save. Enter saves, Escape cancels, and focus goes back to the session's row.
- **New team** (`sprockets/TeamDialog.tsx`): the same 440px frame: the name, then four member slots two to a row (52px, a 1px `--border-strong` edge; empty ones dashed, only the next one active). A filled slot shows the Sprocket's 28px character (still), its name and its project. The first stands in front in the team's face; a slot's menu moves its Sprocket to the front or removes it; the empty slot's lists the Sprockets that aren't in yet.
- **Confirm** (`ConfirmDialog.tsx`): the same 440px frame: a question as the title ("Clear this chat?"), what will happen in muted text, then Cancel and the action named for what it does ("Clear chat"; a danger button when it deletes something, and then Cancel has the focus). Focus goes back to the button that opened it (or, when a menu item opened it, the menu's button). Every "are you sure" and every error from something done outside a dialog uses it, never the browser's `confirm()` or `alert()`: an error is a notice, the same frame with one Close button (`showNotice`, shown by `<Notices />` in `App.tsx`, one at a time).
- **Settings rows:** what it is (and why) on the left, the control on the right, a rule between rows; rows wrap under each other on phones. A row reached from search is marked in `--tint` for a moment.

### Home and the composer
- **Home:** an Eyebrow ("NEW CHAT") over the Display XL headline, then the composer, then "Add project" (a default button), all on the column's left edge.
- **Composer** (`components/ui/Composer.tsx`): a square box, like an editor, (`--field`, 1px `--border-strong`, `--border-focus` while focused) with the text on top and a 44px footer on a rule: the plain dropdowns, each with a rule on its right, then the saved prompts (a 44px icon block, ruled the same way, opening a menu of them), and the send block at the right end (52px wide, a rule on its left, the Ink Button's colors; `--surface-2` with a muted arrow while there's nothing to send). The compact composer (chats) is one row: the text, then the saved prompts' 44px block and a 44px send block, each with a rule on its left.

### Chat (Sprockets)
- The composer is 12px wider than the message column on each side, so its edges sit outside the text instead of on the edge where replies start and the user's bubbles end.
- **Bubbles, as in a text app:** the user's messages are square `--surface-2` bubbles on the right, replies the same on the left (at most 620px), one bubble per message with its paragraphs inside. Messages from the same author in a row sit 4px apart, a change of author 20px. A Sprocket's several messages in a row come from separate sends (`send_message`, or text before a tool call); Sprockets are told to write short, like texting. A bubble draws the little Markdown they write (`sprockets/marks.ts`): `**bold**` in 600, `` `code` `` in Space Mono at 0.86em on `--surface` (1px × 4px in), and fenced code blocks as a `--surface` inset, 12.5px Space Mono, 8px × 10px in, scrolling sideways; anything else stays as typed, and previews drop the marks. Rails' own notices are centered 13px `--muted` text. Day stamps are 11px Space Mono capitals, centered.
- **The character appears once per view.** An empty chat greets the user with the 120px character ("Say hello to …", or "app's chat" for a project chat, 24px Space Grotesk; a team's members stand side by side at 72px, each named); once the chat has messages, a single muted line ("This is the beginning of your chat with …", or "of app's chat with …") marks where it starts. Otherwise the character shows beside the name (the list's rows, the chat header, the side panel's bar), while it's on a message (below), and in a team at the foot of each member's replies.
- **The chat header is the character and the name** (a team: its picture, its name, then its members' names in `--muted` 400). An attached Sprocket's two chats follow as tabs (13px, `--muted`; the shown one `--text` with a 2px `--tint-ink` line at the header's foot, the other with a red dot while a reply waits there): the project's name, then Direct. On phones the character makes room for them. Then Clear chat, an icon button with an arrow going round (it starts the chat over; confirmed, disabled while the chat is empty) and the panel toggle at the far right: no project chip, and no line under it (the list's and the panel's headers carry the rule). While the panel is open, the toggle sits at the panel's top right instead, at the same inset, so it never leaves the corner.
- **The panel** (`sprockets/SprocketSettings.tsx`) is in tabs, in its 52px header where a chat's are in the chat header (13px, `--muted`; the shown one `--text` with a 2px `--tint-ink` line on the header's rule): **About** (name, description, model, usage, and Delete, a small danger button, "Delete Lead", confirmed, 28px below them), **Project** (the project, with one muted line saying what it does there; projects another Sprocket looks after are listed, greyed, with its name; then pending handoffs and owners), **Rules** (a Coordinator's only) and **Tools** (a ruled row per connector, MCP server and skill in Customize: its 28px mark (a skill's book in a ruled square), the name over a muted 13px kind and tool count, "Can't connect" in red, and a switch; a muted line links to Customize). Only the tab's page scrolls, so a long list never pushes the others down; the panel opens on the tab last shown. The tabs take the arrow keys; Escape closes the panel. Phones get a back arrow to the chat before the tabs instead of the toggle. A muted "Saved" sits before the right-hand icons for two seconds after each save. Fields are 16px apart, Delete 28px below them. Everything saves as you go: a text field when it loses focus (Enter for the name; Escape puts either back), a choice at once. At most one muted line of help per field. A Sprocket's look is chosen once, in the creator. A team's panel (`sprockets/TeamSettings.tsx`) is one page in the same frame: its name, its member slots (as in New team; each change saves, and a team keeps two), one muted line on how members answer, and Delete.
- **@mentions** (a team's chat): typing `@` lists the members that fit what follows it (a name's start, a word's start, anywhere, then its letters in order), in a menu-like list just above the composer's left edge; arrows move, Enter or Tab picks, Escape dismisses, and the composer is a combobox for screen readers.
- **In a team**, each run of a member's replies has its name over the first, in 13px 500 in its colour mixed 70% with `--text` (so it reads on either theme), and its 26px character (still) at the foot of the last, in a 26px gutter left of the bubbles. A deleted member's read "A deleted Sprocket", with no character. An @mention of a member, in anyone's message, is a chip: its 14px character and its name in 600, on its colour at 16% over `--surface`.
- **Names in a team** (ADR 0033): members' names in messages, with an @ or without, read as chips (the member's 14px face and name, tinted in its colour). A chip is a reference; it wakes nobody. Pass lines from before ADR 0033 aren't shown.
- **A question with options** (`ask_user`; an open question has none and is just the bubble): the question is the member's bubble, and its options sit under it as small buttons (`.btn.small`, 6px apart, wrapping) until it's answered (a message for someone else leaves it waiting); tapping one sends it as the user's message.
- **Cards** (`sprockets/Card.tsx`, ADR 0024): what a Sprocket shows with `show_card`, in the replies' column in place of a bubble, as wide as it needs up to the column. Square, `--surface` with a 1px `--border-strong` edge; the title (15px 600) on a `--border` rule, then the blocks, ruled apart, 10px × 14px in, 14px text. A table runs edge to edge: its column heads in the Caps style, a rule over each row, cells 7px × 14px (10 to 32 characters wide, wrapping between words), tabular numbers; on a narrow screen it scrolls sideways. Facts are a two-column grid: the label in 13px `--text-2`, the value. A checklist has a muted 12px count ("1 of 6 done") and rows with a 16px state icon: done a filled check in `--green` (its text `--text-2`), doing a progress ring in `--amber`, todo a muted circle, each with its word for screen readers. Code and diffs are Space Mono (12.5px; 12px with the diff tokens, the file's path muted above). A card pops in like a bubble; it takes no input.
- **Card actions** (`sprockets/CardActions.tsx`, ADR 0031): the actions on a card ("Wants to use <server>", up to 520px), each a ruled row: a plug icon and its label (14px, 500), the server · tool in Space Mono under it (with an amber "Destructive" after it when the server marks the tool so), its arguments as facts (nested ones as indented lines in Space Mono, `readable.ts`), then Skip and Run (small buttons at the right, kept on one line). A destructive tool's Run turns into an amber "<server> marks this as destructive." with Cancel and "Yes, run it". With more than one waiting, a ruled foot with Run all. A settled action folds to one line like a decided approval: a check (green), skip or x (red) icon, the label, its first argument that reads as words in `--text-2` (ellipsis; ids skipped, nested ones searched), and Ran / Skipped / Failed at the right; opening it shows the tool, arguments and "What it returned" (JSON laid out like the arguments).
- **Approvals** (`sprockets/ApprovalCard.tsx`, ADR 0025): an MCP call a Sprocket asked to make, in the replies' column like a card (up to 520px). Waiting: a 13px muted head on a rule (a plug icon, "Wants to use", the server · tool in Space Mono, and at the right a 6px red dot and "Waiting for you", which wraps below on a phone); the arguments as facts (label and value, long values scrolling); then Deny and Allow (primary, "Running…" while it runs) on a rule at its foot. Once decided it folds to one quiet line on a `--border` edge with no fill: a green check and "Allowed" (an X and "Denied", or all in red "Allowed, but it failed"), the server · tool, and a chevron. It opens (`--tint` on hover, the chevron turning down) onto the arguments, "It didn't run." for a denial, and what came back under a muted 12px "What it returned", in Space Mono.
- **Who's on it** (the reply isn't shown as it's written): once a message is sent, the face of the Sprocket that answers it pops up at the bottom left of the thread (26px, live; a 320 ms rise and overshoot). In a team, where every member reads every message, there's one icon instead (`TeamThinking.tsx`, ADR 0033): a 26px Sprocket, thinking (see Sprockets), whose body turns into the next member's as it moves (the outline morphs, 650 ms, eased, and the colour fades across round the hue wheel, in OKLCH; each holds 1.5–2.4 s), round everyone thinking since the message, with a muted 13px line beside it naming those still thinking, in the team's order ("Becky and Chandler are thinking…"). A member that finishes leaves the line (800 ms later), not the icon. A team has no spin or dots. In a direct or project chat the icon is the Sprocket's row in the list, the same drawing (`<use>`, ADR 0035), so they move exactly alike (a Sprocket of its own where the list isn't shown): while it thinks it becomes three dots in its colour that hop in turn; at each tool step it inspects (reading or looking something up) or rummages (anything else), with the step named beside it in the muted 13px line ("Reading src/db.ts"); as it types it streams. When the reply is done the icon goes, and the row plays the done animation. In a team, the icon goes when the replies land, and the face at the foot of a member's last message, turned and leaning toward it, stays still: a team chat leaves nothing to celebrate. Each message pops in whole (260 ms: a rise from 6px and 96%). With reduced motion the poses hold, the dots stand still and a reply shows whole.
- **Movement** (`sprockets/threadScroll.ts`): Opening a chat starts at its end. New messages are kept in sight, the view gliding (450 ms, cubic ease-out) on with each, never past the top of the newest, unless the user is reading earlier ones: they scrolled up (wheel, touch, keys or scrollbar) and aren't back within 48px of the end. Scrolling back down there, sending or Jump to latest follows again. Sending glides the new message to the top with room reserved below for the reply, unless more than half the view is already empty below the messages; replies fill that room before the view moves. The reserved room is dropped once the user scrolls it out of view.
- **The Soft Edge Rule.** The thread's bottom 48px fades evenly into `--bg`, with a 1.5px blur only in its lower half. It shows only while more messages are hidden below (a scroll-driven animation; browsers without one show no strip). It's the one blur in Rails.
- **Message details** (`sprockets/MessageActions.tsx`): the time and a 14px copy icon in a 28px button, beside the bubble on its inner side, the copy next to it: left of the user's messages (time, copy), right of a reply (copy, time). They take no room, so a run of messages stays close, and show only for the message under the pointer (or whose button has keyboard focus). On a touch screen, tapping a message shows them under it. Cards and session events are wide, so theirs sit in a 28px row under them. None for notices. The time's tooltip is the full date.
- **Events** (`sprockets/EventRow.tsx`, a Coordinator's chat): a session waiting for the user, in the reply column. A 13px muted line with the agent's logo, the session's title in `--text-2` (truncated, so "is asking you" / "is waiting for your reply" and the blue "Open" link to its panel always fit), then what it asked as a quote: a 2px `--border-strong` rule on the left, 14px `--text-2`, at most 6 lines (a dialog's questions with their options in muted 13px under each). When the decision model caught it rather than Rails' rules, a muted line says so. A handoff (ADR 0015) reads "finished a turn; hand off to", then in the quote the receiving session with the note under it. An overlap (ADR 0014) reads "changed the same files as", then each other session with the files under it in 11.5px Space Mono, muted; an edit to another session's owned files (ADR 0016) reads "changed files owned by", or, mixed with overlaps, a muted "owns" after that session's name. A finding (ADR 0029) reads "found something for", then each session with the files the reply named (as an overlap's), then the end of the reply as a quote (one the decision model heard with no file named reads "found something for another session", with only the quote); a quiet one says "nothing for them to do." An agent's message (ADR 0018) reads "wants to tell", with no quote: the draft card under it names the session it's for and holds the text. The Coordinator's reply follows; if it found nothing for the user, a muted line says so instead.
- **Suggestions** (`sprockets/SuggestionCard.tsx`, ADR 0010): a reply a Coordinator suggests, under its message, in pink because it comes from the Sprocket. A square `--surface` card with a 1px `--border-strong` edge (`--border-focus` while focused): a head band in `--pink-tint` on a rule, with the agent's logo, "REPLY TO" (or "MESSAGE FOR", "ANSWER FOR") in 11px pink Space Mono and the session's title (truncated); the reply in a borderless 15px textarea that grows with its text; the rule it followed in muted 13px ("Following your rule: …", ADR 0011); an agent's message (ADR 0018) has a muted 13px line instead, "Written by the session “UI”. Send it only if you'd say it yourself."; then Dismiss and Send (primary) on a full-width rule at its foot. ⌘/Ctrl+Enter sends. A dialog's answer shows as plain text with a muted "Pick this in its panel: Rails doesn't answer dialogs." and "Open panel" (primary) instead of Send. Once sent: a muted 13px line with a pink check, "Sent to" and the title ("Queued for … · after its current turn" when the session was busy), then, if an idle session showed no sign of taking it, "No sign it got there yet. Check its panel before you send it again." in 13px `--amber`, then the sent text quoted like an event; dismissed or out of date: one muted line. A suggestion a newer one replaced isn't shown, except an agent's message, which keeps one muted line, "Replaced by a newer message." (its event row says who wanted to tell whom). Session titles here and in events are cut at a word around 40 characters (`shortTitle`), with the full title as a tooltip.
- **Jump to latest:** a 32px square button (`--surface`, 1px `--border-strong`, Popover shadow) floats centered above the composer while the user reads earlier messages and more than 80px of the messages are hidden below the view.

### Terminal panels
- Dockview themed from the tokens (`.dockview-theme-dark`'s variables, mapped in `styles.css`, so it follows either theme): tab strips on `--sidebar` sitting on a rule, tabs split by rules, the shown tab a square of `--bg` with a 2px bar under it (`--tint-ink` in the pane that has focus, `--border-strong` in the others). Panes share dockview's own 1px rule; its 4px drag handle sits on it. The terminal under each tab is `--term-bg` in both themes. Tab close buttons show on hover or on the shown tab. Double-clicking an agent's tab renames its session.
- **Tab marks:** a 7px red dot after the title when the session needs the user: it waits for a permission or an answer, its turn failed, or a Sprocket has a reply ready for it. Each has its `aria-label` ("Needs you", "Turn failed", "A reply is ready in Sprockets"). Before it, a 13px amber warning icon while another session changed the same files in the last 30 minutes (ADR 0014); its `aria-label` and tooltip name the other session and up to three files.
- **Side panel** (`SidePanel.tsx`): 400px on `--bg` beside the panes, with a 1px `--border` edge; on phones it covers the screen. One 30px toggle (a panel icon) at the right end of the top-right pane's tab bar opens and closes it (`aria-pressed`, pressed while open); it carries a 7px red dot while a reply waits, and then opens on Sprockets, else on the last tab. The panel's header is the same 36px `--sidebar` strip as the tab bars: three ruled 44px icon tabs, **Sprockets** (the robot face, as in the sidebar; a red dot on its corner while a reply waits), **Files** (a folder) and **Git** (a branch), 18px icons in `--muted`, each named by its tooltip and label, the chosen one `--text` on `--bg` with the `--tint-ink` bar; then close. Under it a 40px bar for the tab: the project's Sprocket (20px character, 13px name, a red dot while a reply waits), the project chat's `…` menu and an "Open in Sprockets" ↗; or the branch and refresh. Every row of tabs takes the arrow keys, Home and End, and only its selected tab is in the Tab order (`tabKeys.ts`). Git lists files (a Space Mono status code in its state color, `--surface-2` when chosen) over the diff in 12px Space Mono. **Files** (`FilesPanel.tsx`) is a tree of 26px rows, 13px, indented 14px a level: a muted chevron for folders (turned while open), a muted 16px folder or file icon, the name, and for a changed file its git letter at the right in 11px Space Mono (M, R amber; A, U green; D, ! red), with the name in the same color; a folder holding changes gets a 6px dot in the color of the change that most needs a look. What git ignores is muted; a deleted file stays listed, struck through. `--hover` under the pointer, a 2px `--border-focus` ring on the focused row (the tree pattern: arrows, Home/End, Enter). A file opens in place of the tree: a back button, its path in 12px Space Mono, a two-part File | Changes switch when it changed, reload, then the text in 12px Space Mono with muted line numbers (the first 256 KB). It looks again every 5 seconds while it's shown.

### Sprockets, the logo and avatars (signature)
- **The logo** (`components/ui/Logo.tsx`; the drawing on its own, for pages outside the app, is `assets/logo.svg`): an armadillo facing left, its tail toward the wordmark, made of 5-unit round-ended bars, a domed shell of eight bands, the head and the tail in shorter bars, and four feet in `--muted`; the rest in the text colour, so it follows the theme. In the sidebar it's 50 × 23px, its nose starting at the rows' 8px edge, then the RAILS wordmark 14px after its box. While the pointer is on the brand (or a finger holds it) it walks in place (1.4s: the tail waves, the shell ripples, the head bobs, the feet step in pairs). **In the collapsed sidebar it curls up into a ball**: the eight bands round into a 22px circle of bars resting where its feet stood, and the head, tail and feet tuck in under them. The ball sits on the icon column, which is where the shell stands (the short head is at the rows' edge), so the armadillo curls up in place. Curling: the feet pull in (200ms), the head and tail slide under the shell and fade (320ms), then the shell rounds with a little give (420ms, from 120ms). Uncurling runs the other way, in about half a second. The expand button lies over the ball and shows its panel icon instead on hover or focus. Under reduced motion it neither walks nor animates the curl. The server's sign-in pages show the drawing at 132px. The favicon (`public/favicon.svg`) is the ball cut down to six bars so it still reads at 16px, its ink dark or light with the device.
- **Sprockets** are the product's personality: SVG characters drawn as solids (`solid.ts`, ADR 0005 amended): slices of the outline, denser when turned well aside and stroked to join, so a turn never shows a comb along its side. Every character is mirror-symmetric, so a turn or a roll reads as the same shape moving (lopsided ones, Bean and Lune, read as a different shape and tipped over; they became Blob, a ball, and Drop, a drop point up, its round part 104 across and its soft point 92 above its middle, so it's clearly taller than Blob). Each has its own thickness and roundness (`depth`, `puff` in `characters.ts`): Block is a thin, flat pizza box (10) and Starry nearly as thin (12), Cog and Roo are in between (22–26), and Blob, Drop, Bell and Momo are deep and soft (106–120, nearly as deep as they're wide, puffed 0.4), drawn as slices whose outline shrinks toward the front and back, about one every 4 units. The round four are spun (`spun`): solids turned about their upright middle, so their outline stays put as they turn and only their eyes go round (in a spin, round the back and back again); the flat four are slabs that shear and narrow. Facing you, a Sprocket is its flat drawing. Turned or tipped it's turned as a solid in 3D (tipped, then turned, then rolled) and seen straight on: a thin one narrows to a sliver and shears into a parallelogram, while a round one stays round, its depth filling out the outline, all in its one colour with no shading. Its eyes are big, rounded capsules (14×31 on a body about 120 wide, 15 apart), upright facing you and centred on the body, or happy arcs (^ ^) while it cheers, each 4 units further out than the open eye so they aren't crowded. They're painted on its front, which curves as much as the body is round: every point of an eye is placed on that surface and turned with the body, so as it turns they travel with the face, the far eye narrowing and bending as on a ball (a flat body's eyes stay alike), and they slant with the turn alone: looking up and to the right, each eye's top leans left. Its pose (turn, tip, roll about its middle, nearness to the screen, lean from its base, hop, squash) and where its eyes look are springs in its rig (`engine.ts`, ADR 0035), painted straight into the SVG; its finished animations (`animations.ts`, each saying when it plays) are built from parts in `clips.ts` and share the same blinks, expressions and leaning in, and `#/lab` (dev builds) plays any of them. **At rest** it leans up and to the viewer's right (turned 33°, tipped up 16°, rolled 25° to the left: a Grok bot's resting pose), its face to the upper right, only while nothing's going on: anything it plays (thinking, the dots, a celebration, an idle animation, idling between them) turns it to face you first and moves about facing you, as a Grok bot's clips do, and it leans again once it's done; still, glancing aside every few seconds (10–24° and its eyes, held under two seconds), its eyes now and then changing shape (an expression: squeeze, round dots, wide, a happy squint, a wink, one big and one small, a bounce). **Facing you** (0°) in its open chat's row; **following the pointer** (leaving its resting lean to face you, then turning up to 26° and tipping up to 19° toward it, unrolled and sliding 4 units its way, its eyes on it; all the way once the pointer is at its body's edge, so a row's height gives it its whole range, as a Grok bot's row does; the creator's large one over twice its width) in the creator and in a hovered row (below). **Thinking** (`busy`: the chat header, the face waiting in a chat, the gallery, the side panel's bar) it does one small move after another, each a second or two and never the same twice running: pondering upward, looking one way then the other, peeking round, a nod, a head tilt (rolling up to 22°), a bounce, a scrunch of its eyes, and now and then a spin. **Leaning in** is the motion seen most: on its own clock, alongside those moves, it comes closer to the screen (growing 10–15%), glancing to the viewer's left as it does (turning 20–30°, sliding 6 units and looking that way), and goes back, held, pulsing there once or twice, or breathing slowly; every 1.5–3.5s while thinking, and at rest (where it isn't still) smaller (6–9%) every 5–11s. In a direct chat, as it starts writing, it spins round once with a hop, then turns into the typing dots. In a team, the thinking icon is one Sprocket thinking the same way while it reforms from one member into the next (Chat). **Done**, the face at the foot of a team member's last message holds its resting pose, which looks up toward its message; it holds still, as a team chat leaves nothing to celebrate. Cheer (one piece of 3 s, its happy ^ ^ eyes going with it: from rest, a jelly dance timed like Satisfied, a squash down, then four floating hops side to side (11 units over and back, each a little lower, about 0.4 s in the air), leaning and turning the way it goes with its eyes leading, stretching as it takes off, each landing a quick squash on the ground straight into the next hop, the last one back to the middle, then a slow wobble to a stop), now plays on a row in the list as one of the done animations. **Survey** (as it starts writing a reply in a team: the team's thinking icon, and its row in the list) is one piece of 2.9 s: its eyes pop into dilated circles (24 across, 3 units further apart), then scan once along an upside-down arc (∪), from one side down through the middle to the other and back, with a short pause at each end, its body tipped down 8° and turning after them, as if reading what's below; then it rests while it goes on writing. Idle and activity animations (ADR 0035's amendment) are in the lab only for now: idle ones (Breathe, Look around, Daydream, Doze, Hum, Stretch) play one after another while a Sprocket rests, half a second apart; activity ones play in flight, while it thinks or types (Stream, Focus, Idea, Inspect, Rummage), or once it's done typing, mostly celebrating (Notify, Hooray, Twirl; Puzzled and Droop when it finished stuck or failed). Faces they hold (wide, squint, calm, sleepy, curious, puzzled, down) are wider than tall when narrowed, so they read as narrowed rather than as dots, and an animation blinks only where it plans to. In a direct chat a reply's in-flight icon is the row's own drawing, it becomes three bouncing dots (an ellipsis, its outline splitting into them in 0.4 s) while it thinks, and once it's done the icon goes and the row celebrates; a team's thinking icon moves on its own, is never dots, and goes when the replies land, leaving nothing to celebrate. **Satisfied** (not placed in the app yet) is Cheer's face and timing with a nod in place instead of the dance, one piece of 2.5 s, soft like jelly: it squashes down and dips its head, springs up stretched with its chin raised and floats about half a second, then each landing is a quick squash (on the ground, never in the air) with a nod, straight into a lower hop, three in all, before a slow wobble to a stop, keeping its volume throughout. ^ ^ eyes never blink. Every finished animation plays once like this, for a set time, then goes back to resting. Blinks (300 ms: the lids shut quickly, rest a beat and open softly, the eyes widening a touch as they close) run wherever it isn't still. They're the only motion that runs on its own (the logo walks only under the pointer); with reduced motion each holds its pose. See ADR 0005.
- **Avatars:** eight pixel-pattern circles; the chosen one in the picker gets a ring in `--text` and a check badge. The avatar button in Settings dims and shows a 16px pencil on hover or keyboard focus.

## Do's and Don'ts

### Do:
- **Do** use the CSS variables; add a token to both palettes (and both front-matter entries) when a value repeats, instead of a new hex.
- **Do** check every new screen in both themes, and keep terminals on `--term-bg`.
- **Do** use Tabler icons (16px in menus and rows, 18px in the sidebar) for every icon.
- **Do** pair every state color with text or an `aria-label`.
- **Do** keep keyboard focus visible: the global 2px blue ring, or the field edge.
- **Do** give every control its hover, focus, disabled and error states, and every list an empty state that says what to do.
- **Do** check new UI at desktop (1440 × 900), in the collapsed rail and on a phone (390 × 800).

### Don't:
- **Don't** round a corner outside the shapes listed above, or put a box around what a rule can divide.
- **Don't** use a native `<select>` or unstyled scrollbars: the app has its own Dropdown and thin scrollbars in the line color.
- **Don't** use a hue for decoration or for another hue's job (The Three Hues Rule).
- **Don't** add transitions or entrance animations to the chrome. The only motion is the mobile drawer slide (0.2s), the logo's walk and curl, the chat's glide to a sent message, a reply's text fading in, the Sprockets and the creator's name ideas, and all of it stops under `prefers-reduced-motion` except the Sprockets' own setting (and the scroll-linked edge fade, which isn't motion over time).
- **Don't** put a shadow on something that sits in the page flow, or drop the 1px edge from a floating layer.
- **Don't** use emoji or Unicode glyphs (✓, ×, →) as icons.
- **Don't** show full filesystem paths; show the project's name.
- **Don't** set names, messages or buttons in capitals, or use Space Mono for prose.
