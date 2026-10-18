# Rails

A self-hosted, multi-device agent multiplexer. Attach a project folder, see every Claude Code, Codex and
pi session that already exists for it, and run the agents' own terminal UIs side by side in panels you
can split, resize and rearrange, from your laptop or phone.

Projects are added with your operating system's own folder picker (Finder on macOS, zenity/kdialog on
Linux), which opens on the machine running Rails.

Requires Node 24+, **tmux 3.2+** (every panel runs in it) and the agents' CLIs on the server's `PATH`.
`make dev`, `make start` and `make install` check for tmux and install it with Homebrew, apt or dnf when
it's missing (`make system-deps` does only that step). On Linux, node-pty compiles during `npm install`,
so you also need python3, make and a C++ compiler.

With Nix you can skip all of that: `nix develop` gives a shell with the pinned Node, tmux and (on Linux)
build tools from `flake.lock`; then use `make` as usual. The agent CLIs still come from your own `PATH`.
If flakes aren't enabled in your Nix config, run
`nix --extra-experimental-features 'nix-command flakes' develop`.

```sh
make dev               # installs deps if needed; server on :4317, UI on http://localhost:5173
# open the "open: …?token=…" URL printed in the terminal
make                   # list all targets
```

Production: `make start`, then open `http://<host>:4317/?token=…` (`make token` prints the token).
Use `make dev-lan`, or set `RAILS_HOST=0.0.0.0`, to reach it from other devices (for example over Tailscale). The token is stored in
`~/.rails/config.json`.

Status:
- Discovery for Claude Code, pi and Codex (Codex is untested)
- Terminal panels running `claude`, `pi`, `codex` (untested) or a shell, backed by tmux so they survive
  server restarts and are shared across devices
- Per-project split/tab layouts, saved on the server
- Read-only git status and diffs
- Official agent logos in the sidebar
- Sprockets (ADR 0005, 0006): always-on agent characters that reply on your own model provider (API key
  or "Continue with ChatGPT"), attach to a project, follow a short description you write and see what every session
  in the project is doing (ADR 0007)
- A red dot when an agent needs you (a permission, a question) or its turn failed

Docs: [architecture](docs/architecture.md) · [glossary](docs/CONTEXT.md) · [decisions](docs/adr) · [provider formats](docs/providers.md) · [roadmap](docs/roadmap.md)

Working on Rails with a coding agent? Start with [AGENTS.md](AGENTS.md).
