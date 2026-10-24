// Starts Rails: its services, the HTTP server (the routes are in app.ts) and the terminals' WebSocket.
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { onSignedOutEverywhere } from "./settings/account.ts";
import { app, upgradeAuthorized } from "./app.ts";
import { startAutomations, stopAutomations } from "./automate/automations.ts";
import { watchCodex } from "./bridge/codex.ts";
import { loadAttention } from "./bridge/index.ts";
import { prepareClaudeMod } from "./bridge/wiring.ts";
import { accessToken, HOST, PORT } from "./config.ts";
import { panels } from "./db.ts";
import { startDecisions } from "./coordination/decisions.ts";
import { startFindings } from "./coordination/findings.ts";
import { startHandoffs } from "./coordination/handoffs.ts";
import { disconnectAll } from "./customize/mcp.ts";
import { startOverlaps } from "./coordination/overlaps.ts";
import { startOwners } from "./coordination/owners.ts";
import { resumeRuns } from "./sprockets/runs.ts";
import { startShellEdits } from "./coordination/shellEdits.ts";
import { startSuggestions } from "./coordination/suggestions.ts";
import { TerminalHub } from "./workspace/terminals.ts";
import { version as tmuxVersion } from "./workspace/tmux.ts";
import { startWatches } from "./coordination/watches.ts";

const hub = new TerminalHub();
// After "sign out everywhere", close every connection; browsers with the new token reconnect. The delay
// lets the device that asked receive its new cookie before its own socket drops.
onSignedOutEverywhere(() => setTimeout(() => hub.disconnectAll(), 1000));

// A promise nobody waits on that fails (a Sprocket run, a watch, a sign-in) is logged, not fatal: Node would
// otherwise stop the whole server, and with it every run, watch and automation.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));
loadAttention(panels.all());
startWatches(); // Coordinators hear about sessions that wait for the user
startOverlaps(); // and about sessions changing the same files; their tabs show it
startHandoffs(); // and when a session a handoff waits for finishes
startOwners(); // owners go with their panels
startShellEdits(); // files shell commands change count as edits too
startSuggestions(); // suggested replies expire as their sessions move on
startDecisions(); // the fast decision model judges in shadow, if the user picked one
resumeRuns(); // Sprocket runs cut off by the last shutdown say so; queued ones start (ADR 0023)
watchCodex(panels.all()); // Codex panels that survived a restart
void prepareClaudeMod(); // Rails' Claude Code mod, for answering its questions (ADR 0028)
startAutomations(); // automations run when they're due, once for any missed while the server was off (ADR 0032)
startFindings(); // a reply that names work in another session's files wakes the Coordinator (ADR 0029)

void tmuxVersion().then((v) => {
  if (!v) console.warn("warning: tmux isn't installed, so panels can't run. Run `make system-deps`.");
});

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, () => {
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`Rails server on ${url}`);
  console.log(`open: ${process.env.NODE_ENV === "production" ? url : "http://localhost:5173"}/?token=${accessToken()}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/ws" || !upgradeAuthorized(req.headers)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => hub.connect(ws));
});

const shutdown = () => {
  stopAutomations();
  hub.detachAll(); // panel processes keep running in tmux
  // MCP servers Rails started (ADR 0025) stop with it; give them a moment.
  void Promise.race([disconnectAll(), new Promise((r) => setTimeout(r, 1500))]).finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
