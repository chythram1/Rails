# rails

A self-hosted, multi-device web UI for coding agents. Attach a project folder, see every Claude Code,
Codex and pi session that already exists for it, and chat with or resume them from your laptop or phone.

```sh
npm install
npm run dev            # server on :4317, UI on http://localhost:5173
# open the "open: …?token=…" URL printed in the terminal
```

Production: `npm run build && npm start`, then open `http://<host>:4317/?token=…`.
Set `RAILS_HOST=0.0.0.0` to reach it from other devices (for example over Tailscale). The token is stored in
`~/.rails/config.json`.

Status (v1 scaffold):
- Discovery and transcript viewing for Claude Code, pi, and Codex (Codex is untested)
- Live chat, resume, tool approvals, and permission modes for Claude Code
- Read-only git status and diffs
- Official agent logos in the sidebar

Docs: [architecture](docs/architecture.md) · [glossary](docs/CONTEXT.md) · [decisions](docs/adr) · [provider formats](docs/providers.md) · [roadmap](docs/roadmap.md)

Working on rails with a coding agent? Start with [AGENTS.md](AGENTS.md).
