// How each agent is wired to the bridge when a panel starts it (ADR 0007). Only command-line flags, so
// the user's own agent settings files are never touched:
// - Claude Code: `--settings` with HTTP hooks to /bridge/<panelId>/claude/<Hook>. SessionStart has to be
//   a command hook (an HTTP SessionStart hook doesn't fire), which curls the same endpoint and adds the
//   session's message socket. Hooks never block: if Rails is down, the agent carries on.
// - pi: `--extension` with pi/rails.ts (pi lists it as rails.ts), which posts its events the same way.
// - Codex: nothing. Its interactive sessions run on a shared app-server daemon that Rails listens to
//   (codex.ts), and any `-c` flag would make Codex run without that daemon.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PanelKind } from "@rails/shared";
import { PORT } from "../config.ts";

const PI_EXTENSION = join(dirname(fileURLToPath(import.meta.url)), "pi", "rails.ts");

const CLAUDE_HOOKS = ["UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"] as const;

function claudeSettings(panelId: string): string {
  const url = (hook: string) => `http://127.0.0.1:${PORT}/bridge/${panelId}/claude/${hook}`;
  const http = (hook: string, timeout = 3) => ({
    type: "http",
    url: url(hook),
    timeout,
    headers: { Authorization: "Bearer $RAILS_PANEL_TOKEN" },
    allowedEnvVars: ["RAILS_PANEL_TOKEN"],
  });
  const hooks: Record<string, unknown[]> = Object.fromEntries(CLAUDE_HOOKS.map((h) => [h, [{ hooks: [http(h)] }]]));
  // Questions to the user (AskUserQuestion) wait for an answer: report them before they run. So do shell commands,
  // so Rails can see which files they change (shellEdits.ts). That one runs before every command, so it waits at
  // most 1 s: Rails answers at once (and a stopped Rails refuses the connection at once), so only a stuck Rails
  // could ever make a command wait.
  hooks.PreToolUse = [
    { matcher: "AskUserQuestion", hooks: [http("PreToolUse")] },
    { matcher: "Bash", hooks: [http("PreToolUse", 1)] },
  ];
  hooks.SessionStart = [
    {
      hooks: [
        {
          type: "command",
          timeout: 3,
          command:
            'curl -s -m 2 -X POST -H "Authorization: Bearer $RAILS_PANEL_TOKEN" -H "content-type: application/json" --data-binary @- ' +
            `"${url("SessionStart")}?inbox=$CLAUDE_CODE_MESSAGING_SOCKET" >/dev/null 2>&1 || true`,
        },
      ],
    },
  ];
  return JSON.stringify({ hooks });
}

/** Flags that wire an agent to the bridge, inserted right after its program name. */
export function bridgeFlags(kind: PanelKind, panelId: string): string[] {
  switch (kind) {
    case "claude":
      return ["--settings", claudeSettings(panelId)];
    case "pi":
      return ["--extension", PI_EXTENSION];
    default:
      return [];
  }
}
