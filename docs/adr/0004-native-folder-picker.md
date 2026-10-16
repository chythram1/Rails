# ADR 0004: Add projects with the native folder picker

Status: accepted. Supersedes ADR 0001 item 11 (project suggestions).

"Add project" opens the operating system's own folder picker on the machine running the rails server:
Finder's folder dialog on macOS (`osascript … choose folder`), zenity or kdialog on Linux, and the
Windows folder browser (PowerShell) on Windows. There is no in-app dialog, path field or list of
suggested folders. Picking a folder that is already a project opens that project.

Why: the in-app dialog (path field, suggestions from provider stores, later a server-side folder browser)
felt clunky, and suggestions kept offering projects the user had just removed.

*Amended:* "Add project" now opens a small menu first (`ref/new-project.png`): a search field, a
"Recent" list of folders where agents have sessions and that aren't projects yet (names only, newest
first, at most 8 rows; picking one adds it), and "Open folder…", which runs the native picker as
before. A removed project's folder shows up in Recent again, so re-adding it is one click.

Consequences:
- The picker appears on the **server's** screen. From another device (a phone over Tailscale) you can
  click Add project, but the dialog opens on the host machine. That's fine while rails is used on the host.
- The server needs a desktop session. Headless Linux servers can't add projects through the UI
  (`POST /api/projects {"path": …}` still works).
- Only one picker is open at a time; the request waits until the user picks or cancels.
- Project removal no longer needs any "hide from suggestions" state.
