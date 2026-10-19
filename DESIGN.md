---
version: alpha
name: Rails
description: A quiet, dark control room around the terminals of Claude Code, Codex and pi.
colors:
  primary: "#ececec"
  bg: "#121212"
  sidebar: "#171717"
  surface: "#1f1f1f"
  surface-2: "#262626"
  hover: "#2a2a2a"
  border: "#2c2c2c"
  border-strong: "#3a3a3a"
  border-focus: "#6a6a6a"
  focus: "#8a8a8a"
  text: "#ececec"
  text-2: "#cfcfcf"
  muted: "#929292"
  green: "#3fb950"
  amber: "#e3b341"
  red: "#f0605a"
  blue: "#6aa7ff"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 36px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: -0.02em
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 500
    lineHeight: 1.5
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.5
  title-sm:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "Geist Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  2xl: 20px
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
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: 7px 14px
  button-hover:
    backgroundColor: "{colors.hover}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.bg}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: 7px 14px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.red}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  nav-item:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text-2}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: 40px
  nav-item-active:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.text}"
  row-selected:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 6px
  menu-item-active:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.xs}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  menu-separator:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
  secondary-text:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
  chat-bubble:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: 18px
    padding: 9px 14px
  status-live:
    textColor: "{colors.green}"
  status-busy:
    textColor: "{colors.amber}"
  status-attention:
    textColor: "{colors.red}"
  diff-hunk:
    textColor: "{colors.blue}"
  focus-ring:
    textColor: "{colors.focus}"
  field-focus:
    textColor: "{colors.border-focus}"
---

# Design System: Rails

The tokens live in `packages/web/src/styles.css` (`:root`, at the top). That file is the source of truth: the colors in the front matter above mirror it, and `packages/web/src/design.test.ts` fails if they drift. Use the CSS variables (`var(--surface)`), never the hex values. The visual references are `ref/style.png`, `ref/panels.png` and Claude's and ChatGPT's desktop apps.

## Overview

**Creative North Star: "The Quiet Control Room"**

Rails is where someone watches and steers several coding agents at once. The terminals are the work; everything around them is a calm, dark frame that stays out of the way, so the one thing that changed (an agent that needs you, a failed turn) is what you notice first. Color means state, never decoration. Personality lives in a few deliberate places, the Sprockets and the avatars, and nowhere else.

It's an operate surface: dense, familiar and consistent from screen to screen. Standard affordances (sidebar, tabs, menus, dialogs, fields) look and behave the way a user of Claude's or ChatGPT's desktop apps expects. Polish shows in alignment and restraint rather than effects.

**Key Characteristics:**
- Near-black, neutral (not blue-tinted) surfaces stacked in small tonal steps.
- White as the only accent; green, amber and red only for state.
- One sans family (Geist) at a tight scale; mono only for code.
- Flat by default; borders and tone carry hierarchy; shadows only on floating layers.
- No motion in the chrome. The Sprocket characters are the one animated thing.

## Colors

A neutral grayscale ladder with a white accent and three state colors.

### Primary
- **Paper White** (`--primary`): primary buttons and the send button's hover fill. Text on it is `--bg`. On hover it brightens to pure white.

### Neutral
- **Canvas** (`--bg`): the page, terminal panels and fields (a field is a hole cut into a surface).
- **Sidebar** (`--sidebar`): the sidebar, the dock's tab strip, the side panel's header and the Settings nav.
- **Surface** (`--surface`): raised things: menus, dialogs, cards, the composer, buttons.
- **Surface 2** (`--surface-2`): the selected row, user chat bubbles, avatar placeholders.
- **Hover** (`--hover`): hover and active-item fill.
- **Hairline** (`--border`) and **Strong Hairline** (`--border-strong`): region dividers, and the edges of controls and floating layers.
- **Focus Line** (`--border-focus`): a field's border while focused or open; the send button's outline.
- **Focus Ring** (`--focus`): keyboard focus rings and the outline of a chosen option.
- **Ink** (`--text`), **Soft Ink** (`--text-2`, navigation labels and inactive tabs) and **Muted** (`--muted`, secondary text and every placeholder).

### Tertiary (state)
- **Live** (`--green`): an open panel's session dot, success marks, added diff lines.
- **Working** (`--amber`): busy agents, reconnecting, modified files.
- **Needs you** (`--red`): attention dots, errors, destructive actions, deleted lines.
- **Hunk** (`--blue`): diff hunk headers. Nothing else is blue.

**The Color Means State Rule.** A hue appears only to say something about state (live, working, needs you, failed, added, deleted). Hover, selection, focus, links and branding stay grayscale. The one exception is the agents' own logos (`ProviderIcon`), which keep their brand colors because they identify the agent.

**Deliberate one-offs.** A few literals stay out of the tokens on purpose: the diff line text tints (`#9be3a6`, `#f2a3a0` on 12% green and red), the idle session dot (`#555`), the scrollbar thumb on hover (`#4a4a4a`), the Sprockets' ground shadow (`#000`), and the black backdrops and shadows listed under Elevation & Depth. Don't turn them into tokens or copy them elsewhere.

**The No Blue Rule.** No blue focus rings, selections, drop highlights or links. Focus is `--focus`, text selection is translucent white, dockview's drop target is a faint white.

**The Two Palettes Rule.** The pastel palettes of the Sprockets (`sprockets/characters.ts`) and the avatars (`assets/avatars/`) belong to those characters. They never color chrome.

## Typography

**Body Font:** Geist (`var(--font)`, bundled with `@fontsource-variable/geist`).
**Mono Font:** Geist Mono (`var(--mono)`), for code, diffs, git status codes and tokens.
**Terminals** use the system monospace on purpose, for glyph coverage. Never load fonts from a CDN.

**Character:** one neutral sans that's comfortable for long sessions; hierarchy comes from size and weight, never from case or letter-spacing.

### Hierarchy
- **Display** (500, 36px, -0.02em): the Home greeting only. 28px on phones.
- **Headline** (500, 28px): page titles, the sign-in title.
- **Title** (600, 20px): dialog titles. Settings group headings are 16px/600; the Sprocket intro name is 18px/500; the Home composer's text is 17px.
- **Title small** (600, 15px): pane headers (a Sprocket's name, "Settings" in its panel).
- **Body** (400, 15px/1.5): the page default and chat messages.
- **UI** (400, 14px): controls, rows, menus, fields, settings labels (500 when it names a setting).
- **Label** (400, 13px): secondary lines, help text, tabs, small buttons.
- **Caption** (400, 12px): timestamps, menu headings, small tags.

**The Weight Steps Rule.** 400 for text, 500 for setting labels and headings of 28px and up, 600 for titles of 15–20px. Never 700.

**The No Costume Rule.** No uppercase labels, eyebrows or kickers, and no mono for decoration. Times and counts use `font-variant-numeric: tabular-nums`.

## Layout

The app is a shell: a resizable sidebar (300px by default) and a main area. Workspaces are dockview panes split by 6px (side by side) or 4px (stacked) gutters, with 36px tab strips. Page headers are 52px tall. Content columns cap their width: pages 1080px, chat messages 760px, the chat composer 800px, Settings 880 × 640px.

Spacing runs on 4px steps (`spacing` above) with 2px half-steps (6, 10, 14px) for tight rows and controls: 4–8px inside a group, 12–16px between groups, 24–40px between sections (Settings groups sit 40px apart). Rows are 40px in the sidebar nav and about 35px for sessions.

- **The Icon Column Rule.** Sidebar icons sit on one vertical line (`--icon-x`) in both the expanded sidebar and the collapsed rail, so collapsing never moves an icon.
- **The Shell Holds Rule.** At 860px and below, the sidebar becomes a drawer, the workspace shows one panel at a time, Settings fills the screen and the Sprockets page shows either the list or a chat. Component-level changes use container queries (the Sprocket settings panel overlays the chat when its container is under 720px).
- Hover styles live inside `@media (hover: hover)`, so a tap never leaves a row lit.

## Elevation & Depth

Depth comes from tone, not shadow: each layer is one step lighter on the gray ladder (canvas → sidebar → surface → surface 2), and 1px hairlines divide regions. Inline things (rows, cards, panels, the composer) have no shadow.

### Shadow Vocabulary
- **Popover** (`0 12px 32px rgb(0 0 0 / 0.45)`): menus and dropdown lists.
- **Dialog** (`0 24px 64px rgb(0 0 0 / 0.5)`): Settings and the avatar picker, over a `rgb(0 0 0 / 0.4–0.55)` backdrop.
- **Overlay panel** (`-12px 0 32px rgb(0 0 0 / 0.4)`): the Sprocket settings panel when it lies over the chat.

**The Lit Edge Rule.** A floating layer gets both a 1px `--border-strong` edge and a shadow, because on a near-black page a shadow alone disappears. Nothing that sits in the page flow gets a shadow.

## Shapes

Soft rectangles throughout, with radius growing with the size of the thing.

- **6px** (`rounded.xs`): items inside menus and lists.
- **8px** (`rounded.sm`): rows, 30px icon buttons, Settings tabs, small search fields.
- **10px** (`rounded.md`): buttons, fields, dropdown triggers, nav items.
- **12px** (`rounded.lg`): menus, grouped lists, callouts, picker tiles.
- **16px** (`rounded.xl`): dialogs.
- **18–24px**: conversational surfaces: chat bubbles (18px), the composer (20px, `--radius-lg`, 24px when compact), Sprocket cards (20px).
- **Pills** (999px) for tags and chips; **circles** for avatars, status dots, swatches and the send button.

**The Nesting Rule.** An inner corner is the outer radius minus the padding between them: a 12px menu with 6px padding has 6px items.

## Components

### Buttons
- **Default:** `--surface` fill, 1px `--border-strong`, 10px radius, 7px × 14px, 14px text; hover fills `--hover`. **Small:** 4px × 10px, 13px.
- **Primary:** Paper White with canvas-colored text. One per view.
- **Danger:** red text on the default button; never a red fill.
- **Icon buttons:** 30px square, 8px radius, `--muted` icon that turns `--text` with a `--hover` fill on hover. Icon-only buttons always have an `aria-label`.

### Inputs / Fields
- **Style:** `--bg` fill inside a surface, 1px `--border-strong`, 10px radius, 8px × 12px, 14px.
- **Focus:** the border turns `--border-focus`; no glow. Everything else focusable shows the 2px `--focus` ring.
- **Placeholder:** `--muted`. **Disabled:** 0.5–0.6 opacity.

### Dropdowns and menus
- **Dropdown** (`components/Dropdown.tsx`) replaces every native `<select>`: a field-like trigger with a chevron, a list in a menu popover, a check on the chosen option, group headings, optional icons (agent logos), disabled options, and a search field from 10 options up. The **plain** variant drops the field look for pickers inside another control (the Home composer's project and agent): `--text-2` label, `--hover` fill when hovered or open.
- **Menus** (`MenuButton` / `usePopover` in `components/Menu.tsx`): `--surface`, 12px radius, 6px padding, items at 14px with 16px Tabler icons, 12px muted headings, red for destructive items, shortcuts right-aligned in `--muted`.

### Switches
- **Switch** (`components/Switch.tsx`, refs: Replit's and Higgsfield's settings rows) for a setting that applies at once: a 36 × 20 pill with a 14px knob, `--surface-2` with a `--muted` knob when off (the knob lightens on hover), Paper White (`--primary`) with a `--bg` knob when on. No slide: chrome doesn't move. It sits on the right of its row, level with the label; the label and a one-line description (what turning it on does) are on the left. It's a `button` with `role="switch"`, named by its `<label>`.

### Lists of short texts
- **Rules** (a Coordinator's settings, ADR 0011): numbered rows that are fields themselves: `--bg`, 1px `--border-strong`, 10px radius, a muted 13px number, the sentence in a borderless 14px textarea that grows with it, and a 26px remove button (14px X). The row takes the `--border-focus` edge while edited; Enter saves, Escape puts it back. Below, an "Add a rule" field (an example sentence as its placeholder while the list is empty) that shows its count, Cancel and Add once something's typed.

### Logs
- **Shadow log** (Settings → Models, `settings/DecisionsSettings.tsx`, ADR 0012): a summary sentence in muted 13px, then a bordered 12px-radius list (scrolls past 420px) with one row per judgment: the agent's logo, the session's title (500, truncated), "ended its turn" / "showed a dialog" and the time in muted 13px; the judged text quoted (2px `--border-strong` rule, `--text-2`, two lines at most); then the verdicts side by side at 13px: "Rails: …", "Model: … (91%)", "Coordinator: …" and the model version, latency and cost in muted. Where the model and Rails differ, an amber "Differs" (a state color, with its word). Errors show in red in place of the model's answer.

### Navigation
- **Sidebar:** nav items 40px tall, 18px icons, `--text-2` labels that turn `--text` on hover. The current page gets a `--hover` fill; "New chat" sits on `--surface-2`.
- **Session rows:** status dot, title, provider logo, time (tabular). Dot colors: gray idle, green live, amber working, red needs you, each with an `aria-label`.
- **Account row:** the profile's 28px avatar and name with a chevron; an amber dot and "· Reconnecting…" only while the connection is down.

### Dialogs
- Native `<dialog>` (focus trap, Escape, inert page), `--surface`, 16px radius, Popover/Dialog shadow. Escape and a backdrop click close only the topmost dialog.
- **Settings rows:** what it is (and why) on the left, the control on the right, a hairline between rows; rows wrap under each other on phones.

### Chat (Sprockets)
- The composer is 12px wider than the message column on each side, so its round ends sit outside the text instead of on the edge where replies start and the user's bubbles end.
- The user's messages are `--surface-2` bubbles (18px radius) on the right; replies read as plain text with no bubble; Rails' own notices are centered 13px `--muted` text. Day stamps are 12px, centered.
- The pending reply ("Thinking…" with the Sprocket's 22px icon, then the text as it's written) sits in the message column exactly where the reply will land, so nothing jumps when it's done.
- Movement follows claude.ai (`sprockets/threadScroll.ts`). Opening a chat starts at its end and follows new messages while the view is at the very bottom. Sending glides (450 ms, cubic ease-out, our own animation: the browser's smooth scroll is over in ~0.2 s and reads as a jump) the new message to the top with room reserved below for the reply, unless more than half the view is already empty below the messages: then nothing moves and the reply fills that space. The reserved room shrinks as the reply grows, a long reply streams on below the fold, and the room is dropped once the user scrolls it out of view.
- **Replies appear like claude.ai's** (`sprockets/revealText.tsx`): text is revealed at an even pace about 0.3 s behind what has arrived (the server sends it in bursts every 120 ms), and each newly revealed stretch fades in over 400 ms ease-out. A reply that arrives whole is revealed the same way, faster; the saved message carries on from the written-out text without restarting. Screen readers get each reply once, whole.
- **The Soft Edge Rule.** The thread's bottom 48px fades evenly into `--bg` (after claude.ai's 28px scroll-fade strip, taller and softer), with a 1.5px blur only in its lower half, under the darker part of the fade: blurred light text on a dark page casts a halo that reads as a glow wherever the fade can't cover it. It shows only while more messages are hidden below (a scroll-driven animation; browsers without one show no strip). It's the one blur in Rails: no other glass or blur.
- **Message details** (`sprockets/MessageActions.tsx`, ref `message.png`): a 28px row under each of the user's messages (the time, "23 minutes ago" at 12px, then a 14px copy icon in a 28px button, on the right) and each reply (copy, then the time, from the left); none under notices. The row always takes its space, which is what separates messages, and shows only for the message under the pointer (or whose button has keyboard focus); on touch screens it always shows. The time's tooltip is the full date.
- **Run log:** above a reply, one muted 13px line says what the Sprocket looked at or did for it ("Looked at the board, read 2 conversations and searched for “fetchUser”"). While it works, "Thinking…" names the step it's on ("Reading src/api.ts…") and the line builds up above it; the saved reply carries the same line, so nothing moves when it lands.
- **Events** (`sprockets/EventRow.tsx`, a Coordinator's chat): a session waiting for the user, in the reply column. A 13px muted line with the agent's logo, the session's title in `--text-2` (truncated, so "is asking you" / "is waiting for your reply" and the underlined "Open" link to its panel always fit), then what it asked as a quote: a 2px `--border-strong` rule on the left, 14px `--text-2`, at most 6 lines (a dialog's questions with their options in muted 13px under each). The Coordinator's reply follows as a normal reply; if it found nothing for the user, a muted 13px line says so instead.
- **Suggestions** (`sprockets/SuggestionCard.tsx`, ADR 0010): a reply a Coordinator suggests, under its message. A `--surface` card (1px `--border-strong`, 12px radius, 10px × 12px) whose whole body is the field: a 13px muted head with the agent's logo, "Reply to" and the session's title (truncated), the reply in a borderless 15px textarea that grows with its text, the rule it followed in muted 13px ("Following your rule: …", ADR 0011), then Dismiss and Send (primary) at the foot; the card takes the field's `--border-focus` edge while focused, and ⌘/Ctrl+Enter sends. A message the user asked for reads "Message for" in the head. A dialog's answer shows as plain text with a muted "Pick this in its panel: Rails doesn't answer dialogs." and "Open panel" (primary) instead of Send. Once sent: a muted 13px line with a 14px check, "Sent to" and the title ("Queued for … · after its current turn" when the session was busy), then the sent text quoted like an event; dismissed or out of date: one muted line ("Not sent: Fix sidebar moved on.").
- **Jump to latest:** a 32px round button (`--surface`, 1px `--border-strong`, Popover shadow) floats centered above the composer while more than 80px of the messages are hidden below the view.

### Terminal panels
- Dockview themed from the tokens (`.dockview-theme-dark` overrides in `styles.css`); the xterm theme in `TerminalView.tsx` mirrors `--bg`, `--text` and `--border-strong`. Tab close buttons show on hover or on the active tab.
- **Tab marks:** a 7px red dot after the title when the session needs the user: it waits for a permission or an answer, its turn failed, or a Sprocket has a reply ready for it. Each has its `aria-label` ("Needs you", "Turn failed", "A reply is ready in Sprockets").
- **Side panel** (`SidePanel.tsx`, refs: Snowflake's CoCo, Gumloop): 400px on `--bg` beside the panes, with a 1px `--border` edge; on phones it covers the screen. Two 30px icon toggles at the right end of the top-right pane's tab bar choose its view, Sprockets (robot face) and Git (branch); the one showing is `--hover`-filled (`aria-pressed`), and clicking it again closes the panel. The Sprockets toggle carries a 7px red dot (ringed in `--sidebar`) while a reply waits. The panel's header is the same 36px `--sidebar` band as the tab bars: for Sprockets, the project's Sprockets as tabs (20px character, 13px name, `--hover` fill when chosen, the Coordinator first, a red dot on one with a reply waiting), an "Open in Sprockets" ↗ and close; for Git, "Git", the branch, refresh and close. The Sprockets view is the chosen one's chat (the chat rules above, 16px side padding), opening on a Sprocket with a reply waiting, else the Coordinator. With no Sprockets in the project it says how to attach one.

### Sprockets and avatars (signature)
- **Sprockets** are the product's personality: SVG characters with idle loops (bob, sway, blink, look-at) on a per-character period and phase, so a group never moves in sync. They're the only looping motion in Rails, and they respect their own motion setting. See ADR 0005 and the gotcha about SVG transforms in `AGENTS.md`.
- **Avatars:** eight pixel-pattern circles; the chosen one in the picker gets a white ring and a check badge. The avatar button in Settings dims (`rgb(0 0 0 / 0.5)`) and shows a 16px pencil on hover or keyboard focus.

## Do's and Don'ts

### Do:
- **Do** use the CSS variables; add a token (and its front-matter entry) when a value repeats, instead of a new hex.
- **Do** use Tabler icons (16px in menus and rows, 18px in the sidebar) for every icon.
- **Do** pair every state color with text or an `aria-label`.
- **Do** keep keyboard focus visible: the global 2px `--focus` ring, or the field border.
- **Do** give every control its hover, focus, disabled and error states, and every list an empty state that says what to do.
- **Do** check new UI at desktop (1440 × 820), in the collapsed rail and on a phone (390 × 800).

### Don't:
- **Don't** use a native `<select>` or unstyled scrollbars: the app has its own Dropdown and thin dark scrollbars.
- **Don't** introduce a hue for hover, selection, focus, links or branding (The Color Means State Rule).
- **Don't** add transitions or entrance animations to the chrome. The only motion is the mobile drawer slide (0.2s), the chat's glide to a sent message, a reply's text fading in, the Sprockets and the creator's name ideas, and all of it stops under `prefers-reduced-motion` except the Sprockets' own setting (and the scroll-linked edge fade, which isn't motion over time).
- **Don't** put a shadow on something that sits in the page flow, or drop the 1px edge from a floating layer.
- **Don't** use emoji or Unicode glyphs (✓, ×, →) as icons.
- **Don't** show full filesystem paths; show the project's name.
- **Don't** use font weight 700, uppercase labels or positive letter-spacing.
