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
- **Segmented** (`components/Segmented.tsx`) for a choice of two to four: square segments in one box with a 1px `--border-strong` edge and rules between them, 13px with a 15px icon; the chosen one in `--tint` with `--tint-ink`, others turn `--hover` on hover. Native radios underneath, so Tab reaches the group and the arrow keys move the choice. **Appearance** (Settings → General: Light, Dark, System) is the first.

### Dropdowns and menus
- **Dropdown** (`components/Dropdown.tsx`) replaces every native `<select>`: a field-like trigger with a chevron, a list in a menu, a check on the chosen option (which also has the `--surface-2` fill), group headings in Caps, optional icons (agent logos), disabled options, and a search field (on a rule) from 10 options up. The **plain** variant drops the field look for pickers in a ruled footer (the Home composer's project and agent): `--text-2` 13px, full height, a rule on its right, `--hover` on hover and `--surface-2` while open.
- **Menus** (`MenuButton` / `usePopover` in `components/Menu.tsx`): `--surface`, 1px `--border-strong`, square, no padding: full-width 36px rows with 14px side padding, 16px Tabler icons, rules between sections, Caps headings, red for destructive items, shortcuts right-aligned in 11px Space Mono. Keyboard focus fills the row and draws a 2px blue bar on its left. A menu of choices marks the current one with a check on the right.

### Switches
- **Switch** (`components/Switch.tsx`) for a setting that applies at once: a 36 × 20 pill with a white 16px knob, `--idle` when off (darker on hover), `--green` when on. No slide. It sits on the right of its row, its label and a one-line description on the left; a `button` with `role="switch"`, named by its `<label>`.

### The Sprocket list
- **Grouped by project** (`sprockets/groups.ts`): first **Teams** (team chats, ADR 0022, the most recently active first), then Caps headings with the project's name, in the sidebar's order, then **General** for unattached Sprockets. In a group the Coordinator comes first, then the most recently active. Each Sprocket is one row (a 6px navigation row): the 36px character, the name (500), the time on the right (none while its chats are empty), then the last line of the newer of its chats and the red attention dot while a reply waits in either. An attached Sprocket's row opens its project chat (ADR 0021); its direct chat is a tab away in the chat header. A group's row (`GroupFace.tsx`) puts its members' characters in that 36px box, the lead in front at the bottom (two overlap corner to corner, three stand in a triangle, four in a square), and its last line names who wrote it. Selected: `--surface-2`; hover: `--tint`.
- **Characters in the list stand still** (`still`): no idle loop, blinks or reactions. A list of moving faces is too busy, and a team's row holds several. The gallery, the chats and the creator keep their motion.
- **Filter**, always there so nothing shifts when a second group appears: a 36px ruled strip under the search (which keeps the header to itself) with a plain menu button named after what the list shows: a 14px filter icon, "All Sprockets" or the group's name, a chevron; 13px `--text-2`, `--text`/500 while a group is chosen, `--hover` on hover. Its menu: All Sprockets, then each project with Sprockets and General, the current one checked.
- **One New button**, an icon button (a pen on a square) beside the search, makes either: its menu has New Sprocket and New team (disabled, "Needs two Sprockets", until there are two). It's the way in on phones, which have no gallery; the gallery keeps its New card for Sprockets only.
- **Gallery** (desktop, nothing open): square `--surface-2` cards in a grid, 12px apart, in the order the Sprockets were made, so nothing moves when they're active or moved. Each card: the 84px character top left, the name in Space Grotesk, the chat's last line in muted 13px; `--tint` on hover. The New card is last: an outlined peer (1px `--border-strong`, transparent) laid out like the others, so its lines meet theirs: in a character's frame (the same 84px box and ground shadow) a round-ended plus in `--muted` stands where a body would, then "New Sprocket" and a muted "Pick a look and a name". On hover its edge and plus turn `--tint-ink`.

### Customize
- **Same frame as Sprockets** (`components/customize/`): the searchable list column beside the open item, one at a time on phones. Groups are "Agent profiles" and "Saved prompts" with the same 12px headings; a row is the agent's logo (or a 16px muted message icon), the name, a muted 12px "Default" (plain text, like "Coordinator") and a one-line summary.
- **Header actions:** a small secondary button for the one thing to do with it ("Start" opens a menu of projects; "Use on Home") before the `…` menu, which holds Delete. "In use" is a row of plain underlined links (agent logo, "project · session"), not cards.
- **The editor is Settings rows** (`.set-group`, `.set-row`) at most 720px wide: choices save at once, one-line fields on blur, long texts with Save and Undo under them. A risky choice (Bypass permissions) changes the row's description to a warning, in muted text, never a hue.

### Lists of short texts
- **Rules** (a Coordinator's job page, ADR 0011): one ruled list (a 1px `--border` above and between rows, no boxes) of numbered sentences: a muted 12px Space Mono number (two digits wide), the sentence in a borderless 14px textarea that grows with it, and a 26px remove button (14px X) that shows on hover or focus (always on touch screens). A row is `--hover` under the pointer and becomes a field only while edited (`--field` with a 1px `--border-focus` edge); Enter or leaving it saves, Escape puts it back. "Add" (a small button with a plus) sits at the right of the Rules heading and opens a new row at the end of the list, already a field: Enter adds the rule and leaves a fresh row for the next, Escape closes it. With no rules, the muted line under the heading ends with an example; at ten, Add is disabled and a muted line says that's the most. A rule's count shows at the row's right once it's within 40 characters of the limit.
- **Handoffs** (the job page, under the rules, ADR 0015): square rows with a 1px `--border-strong` edge and a 2px pink left edge (the Coordinator's), a 13px `--text-2` route on top (the sending session's logo and short title, a muted arrow, the receiving session's) and the note under it in 14px, then the remove button, labelled "Cancel the handoff to …". With none waiting, a muted line says how to ask for one, with an example.
- **Owners** (the job page, under handoffs, ADR 0016): the same rows, with the session's logo and short title on top and its paths under it in 11.5px Space Mono, `--text-2`; the remove button is labelled "Remove what … owns". With none, a muted line says how to set them, with an example.
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
- **New team** (`sprockets/TeamDialog.tsx`): the same 440px frame: the name, then four member slots two to a row (52px, a 1px `--border-strong` edge; empty ones dashed, only the next one active). A filled slot shows the Sprocket's 28px character (still), its name and its project; the first slot is the lead's, marked by a star in a 14px circle on the character's corner. A slot's menu makes its Sprocket the lead or removes it; the empty slot's lists the Sprockets that aren't in yet.
- **Confirm** (`ConfirmDialog.tsx`): the same 440px frame: a question as the title ("Clear this chat?"), what will happen in muted text, then Cancel and the action named for what it does ("Clear chat"; a danger button when it deletes something, and then Cancel has the focus). Focus goes back to the button that opened it.
- **Settings rows:** what it is (and why) on the left, the control on the right, a rule between rows; rows wrap under each other on phones. A row reached from search is marked in `--tint` for a moment.

### Home and the composer
- **Home:** an Eyebrow ("NEW CHAT") over the Display XL headline, then the composer, then "Add project" (a default button), all on the column's left edge.
- **Composer** (`components/Composer.tsx`): a square box, like an editor, (`--field`, 1px `--border-strong`, `--border-focus` while focused) with the text on top and a 44px footer on a rule: the plain dropdowns, each with a rule on its right, then the saved prompts (a 44px icon block, ruled the same way, opening a menu of them), and the send block at the right end (52px wide, a rule on its left, the Ink Button's colors; `--surface-2` with a muted arrow while there's nothing to send). The compact composer (chats) is one row: the text, then the saved prompts' 44px block and a 44px send block, each with a rule on its left.

### Chat (Sprockets)
- The composer is 12px wider than the message column on each side, so its edges sit outside the text instead of on the edge where replies start and the user's bubbles end.
- **Bubbles, as in a text app:** the user's messages are square `--surface-2` bubbles on the right, replies the same on the left (at most 620px), a bubble per paragraph, 4px apart (`sprockets/bubbles.ts`: a code block, a list, or a line ending in ":" with what follows stays whole; a paragraph over 320 characters is split between sentences). Sprockets are told to write that way, like texting. Rails' own notices are centered 13px `--muted` text. Day stamps are 11px Space Mono capitals, centered.
- **The character appears once per view.** An empty chat greets the user with the 120px character ("Say hello to …", or "app's chat" for a project chat, 24px Space Grotesk; a team's members stand side by side at 72px, each named, the lead marked); once the chat has messages, a single muted line ("This is the beginning of your chat with …", or "of app's chat with …") marks where it starts. Otherwise the character shows beside the name (the list's rows, the chat header, the side panel's bar), while it's on a message (below), and in a team at the foot of each member's replies.
- **The chat header is the character and the name** (a team: its picture, its name, then its members' names in `--muted` 400). An attached Sprocket's two chats follow as tabs (13px, `--muted`; the shown one `--text` with a 2px `--tint-ink` line at the header's foot, the other with a red dot while a reply waits there): the project's name, then Direct. On phones the character makes room for them. Then the `…` menu (Clear chat…, in red, confirmed; disabled while the chat is empty) and the panel toggle at the far right: no project chip, and no line under it (the list's and the panel's headers carry the rule). While the panel is open, the toggle sits at the panel's top right instead, at the same inset, so it never leaves the corner.
- **The panel** (`sprockets/SprocketSettings.tsx`) has two pages. It opens on the Sprocket's **job**, with no title (screen readers get "Lead settings"): the project (one muted line saying what it does there; projects another Sprocket looks after are listed, greyed, with its name), the rules, pending handoffs and owners. A cog beside the toggle leads to **Settings**, what rarely changes: name, description, model, and Delete (a small danger button, "Delete Lead", confirmed) at the end. Settings has a back arrow at its top left and its title centred (the 52px header is a three-column grid). Focus moves to where the new page starts; Escape on Settings goes back, on the job page closes the panel. Phones get a back arrow to the chat instead of the toggle. A muted "Saved" sits before the right-hand icons for two seconds after each save. Fields are 16px apart, Delete 28px below them. Everything saves as you go: a text field when it loses focus (Enter for the name; Escape puts either back), a choice at once. At most one muted line of help per field. A Sprocket's look is chosen once, in the creator. A team's panel (`sprockets/TeamSettings.tsx`) is one page in the same frame: its name, its member slots (as in New team; each change saves, and a team keeps two), one muted line on how the lead works, and Delete.
- **@mentions** (a team's chat): typing `@` lists the members that fit what follows it (a name's start, a word's start, anywhere, then its letters in order), in a menu-like list just above the composer's left edge; arrows move, Enter or Tab picks, Escape dismisses, and the composer is a combobox for screen readers.
- **In a team**, each run of a member's replies has its name over the first, in 13px 500 in its colour mixed 70% with `--text` (so it reads on either theme), and its 26px character (still) at the foot of the last, in a 26px gutter left of the bubbles. A deleted member's read "A deleted Sprocket", with no character. An @mention of a member, in anyone's message, is a chip: its 14px character and its name in 600, on its colour at 16% over `--surface`.
- **Who's on it** (the reply isn't shown as it's written): once a message is sent, the face of the Sprocket that answers it pops up at the bottom left of the thread (26px, live; a 320 ms rise and overshoot). One face at a time: in a team, the member whose turn it is, once Rails knows it answers (nothing shows while Rails works out who); members whose turns come later wait unseen. When a Sprocket starts writing, its face becomes three dots in its colour on a `--surface-2` pill, rising and fading in turn (1.4 s); in a team the dots sit beside its face, where its reply will be. The reply then comes in a bubble at a time, each popping in (260 ms: a rise from 6px and 96%) after a pause that grows with its length (0.35–1.4 s), with the dots between; a newer message shows the rest at once. Its codemode steps aren't shown. With reduced motion nothing animates, the dots hold still and a reply shows whole.
- **Movement** (`sprockets/threadScroll.ts`): Opening a chat starts at its end. New messages are kept in sight, the view gliding (450 ms, cubic ease-out) on with each, never past the top of the newest, unless the user is reading earlier ones: they scrolled up (wheel, touch, keys or scrollbar) and aren't back within 48px of the end. Scrolling back down there, sending or Jump to latest follows again. Sending glides the new message to the top with room reserved below for the reply, unless more than half the view is already empty below the messages; replies fill that room before the view moves. The reserved room is dropped once the user scrolls it out of view.
- **The Soft Edge Rule.** The thread's bottom 48px fades evenly into `--bg`, with a 1.5px blur only in its lower half. It shows only while more messages are hidden below (a scroll-driven animation; browsers without one show no strip). It's the one blur in Rails.
- **Message details** (`sprockets/MessageActions.tsx`): a 28px row under each of the user's messages (the time, then a 14px copy icon in a 28px button, on the right) and each reply (copy, then the time, from the left); none under notices. The row always takes its space and shows only for the message under the pointer (or whose button has keyboard focus); on touch screens it always shows. The time's tooltip is the full date.
- **Events** (`sprockets/EventRow.tsx`, a Coordinator's chat): a session waiting for the user, in the reply column. A 13px muted line with the agent's logo, the session's title in `--text-2` (truncated, so "is asking you" / "is waiting for your reply" and the blue "Open" link to its panel always fit), then what it asked as a quote: a 2px `--border-strong` rule on the left, 14px `--text-2`, at most 6 lines (a dialog's questions with their options in muted 13px under each). When the decision model caught it rather than Rails' rules, a muted line says so. A handoff (ADR 0015) reads "finished a turn; hand off to", then in the quote the receiving session with the note under it. An overlap (ADR 0014) reads "changed the same files as", then each other session with the files under it in 11.5px Space Mono, muted; an edit to another session's owned files (ADR 0016) reads "changed files owned by", or, mixed with overlaps, a muted "owns" after that session's name. An agent's message (ADR 0018) reads "wants to tell", with no quote: the draft card under it names the session it's for and holds the text. The Coordinator's reply follows; if it found nothing for the user, a muted line says so instead.
- **Suggestions** (`sprockets/SuggestionCard.tsx`, ADR 0010): a reply a Coordinator suggests, under its message, in pink because it comes from the Sprocket. A square `--surface` card with a 1px `--border-strong` edge (`--border-focus` while focused): a head band in `--pink-tint` on a rule, with the agent's logo, "REPLY TO" (or "MESSAGE FOR", "ANSWER FOR") in 11px pink Space Mono and the session's title (truncated); the reply in a borderless 15px textarea that grows with its text; the rule it followed in muted 13px ("Following your rule: …", ADR 0011); an agent's message (ADR 0018) has a muted 13px line instead, "Written by the session “UI”. Send it only if you'd say it yourself."; then Dismiss and Send (primary) on a full-width rule at its foot. ⌘/Ctrl+Enter sends. A dialog's answer shows as plain text with a muted "Pick this in its panel: Rails doesn't answer dialogs." and "Open panel" (primary) instead of Send. Once sent: a muted 13px line with a pink check, "Sent to" and the title ("Queued for … · after its current turn" when the session was busy), then the sent text quoted like an event; dismissed or out of date: one muted line. A suggestion a newer one replaced isn't shown, except an agent's message, which keeps one muted line, "Replaced by a newer message." (its event row says who wanted to tell whom). Session titles here and in events are cut at a word around 40 characters (`shortTitle`), with the full title as a tooltip.
- **Jump to latest:** a 32px square button (`--surface`, 1px `--border-strong`, Popover shadow) floats centered above the composer while the user reads earlier messages and more than 80px of the messages are hidden below the view.

### Terminal panels
- Dockview themed from the tokens (`.dockview-theme-dark`'s variables, mapped in `styles.css`, so it follows either theme): tab strips on `--sidebar` sitting on a rule, tabs split by rules, the shown tab a square of `--bg` with a 2px bar under it (`--tint-ink` in the pane that has focus, `--border-strong` in the others). Panes share dockview's own 1px rule; its 4px drag handle sits on it. The terminal under each tab is `--term-bg` in both themes. Tab close buttons show on hover or on the shown tab. Double-clicking an agent's tab renames its session.
- **Tab marks:** a 7px red dot after the title when the session needs the user: it waits for a permission or an answer, its turn failed, or a Sprocket has a reply ready for it. Each has its `aria-label` ("Needs you", "Turn failed", "A reply is ready in Sprockets"). Before it, a 13px amber warning icon while another session changed the same files in the last 30 minutes (ADR 0014); its `aria-label` and tooltip name the other session and up to three files.
- **Side panel** (`SidePanel.tsx`): 400px on `--bg` beside the panes, with a 1px `--border` edge; on phones it covers the screen. One 30px toggle (a panel icon) at the right end of the top-right pane's tab bar opens and closes it (`aria-pressed`, pressed while open); it carries a 7px red dot while a reply waits, and then opens on Sprockets, else on the last tab. The panel's header is the same 36px `--sidebar` strip as the tab bars: three ruled tabs, **Sprockets** (with the red dot while a reply waits), **Files** and **Git**, 13px/500, the chosen one `--bg` with the `--tint-ink` bar, and close. Under it a 40px bar for the tab: the project's Sprocket (20px character, 13px name, a red dot while a reply waits), the project chat's `…` menu and an "Open in Sprockets" ↗; or the branch and refresh. Every row of tabs takes the arrow keys, Home and End, and only its selected tab is in the Tab order (`tabKeys.ts`). Git lists files (a Space Mono status code in its state color, `--surface-2` when chosen) over the diff in 12px Space Mono. **Files** (`FilesPanel.tsx`) is a tree of 26px rows, 13px, indented 14px a level: a muted chevron for folders (turned while open), a muted 16px folder or file icon, the name, and for a changed file its git letter at the right in 11px Space Mono (M, R amber; A, U green; D, ! red), with the name in the same color; a folder holding changes gets a 6px dot in the color of the change that most needs a look. What git ignores is muted; a deleted file stays listed, struck through. `--hover` under the pointer, a 2px `--border-focus` ring on the focused row (the tree pattern: arrows, Home/End, Enter). A file opens in place of the tree: a back button, its path in 12px Space Mono, a two-part File | Changes switch when it changed, reload, then the text in 12px Space Mono with muted line numbers (the first 256 KB). It looks again every 5 seconds while it's shown.

### Sprockets, the logo and avatars (signature)
- **The logo** (`components/Logo.tsx`; the drawing on its own, for pages outside the app, is `assets/logo.svg`): an armadillo facing left, its tail toward the wordmark, made of 5-unit round-ended bars, a domed shell of eight bands, the head and the tail in shorter bars, and four feet in `--muted`; the rest in the text colour, so it follows the theme. In the sidebar it's 50 × 23px, its nose starting at the rows' 8px edge, then the RAILS wordmark 14px after its box. While the pointer is on the brand (or a finger holds it) it walks in place (1.4s: the tail waves, the shell ripples, the head bobs, the feet step in pairs). **In the collapsed sidebar it curls up into a ball**: the eight bands round into a 22px circle of bars resting where its feet stood, and the head, tail and feet tuck in under them. The ball sits on the icon column, which is where the shell stands (the short head is at the rows' edge), so the armadillo curls up in place. Curling: the feet pull in (200ms), the head and tail slide under the shell and fade (320ms), then the shell rounds with a little give (420ms, from 120ms). Uncurling runs the other way, in about half a second. The expand button lies over the ball and shows its panel icon instead on hover or focus. Under reduced motion it neither walks nor animates the curl. The server's sign-in pages show the drawing at 132px. The favicon (`public/favicon.svg`) is the ball cut down to six bars so it still reads at 16px, its ink dark or light with the device.
- **Sprockets** are the product's personality: SVG characters with idle loops (bob, sway, blink, look-at) on a per-character period and phase, so a group never moves in sync. They're the only motion that runs on its own (the logo walks only under the pointer), and they respect their own motion setting. See ADR 0005 and the gotcha about SVG transforms in `AGENTS.md`.
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
