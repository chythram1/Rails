import type { IPty } from "node-pty";
import type WebSocket from "ws";
import type { ClientMsg, ServerMsg } from "@rails/shared";
import { panels } from "./db.ts";
import { onPanelsChanged, panelEnded } from "./panels.ts";
import * as tmux from "./tmux.ts";

/**
 * Connects browser terminals to panels. Every attached panel gets its own tmux client (a PTY) sized to
 * that browser, so devices share the same process. Closing a browser only detaches its clients.
 */
export class TerminalHub {
  private clients = new Map<WebSocket, Map<string, IPty>>();

  constructor() {
    onPanelsChanged((projectId) => this.broadcast({ type: "panels.changed", projectId }));
  }

  connect(ws: WebSocket) {
    this.clients.set(ws, new Map());
    ws.on("message", (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      try {
        this.handle(ws, msg);
      } catch (e: any) {
        send(ws, { type: "error", message: String(e?.message ?? e) });
      }
    });
    ws.on("close", () => {
      for (const pty of this.clients.get(ws)?.values() ?? []) pty.kill();
      this.clients.delete(ws);
    });
  }

  private handle(ws: WebSocket, msg: ClientMsg) {
    const ptys = this.clients.get(ws)!;
    switch (msg.type) {
      case "term.attach": {
        ptys.get(msg.panelId)?.kill();
        if (!panels.get(msg.panelId)) return; // closed meanwhile; panels.changed updates the browser
        const pty = tmux.attach(msg.panelId, msg.cols, msg.rows);
        ptys.set(msg.panelId, pty);
        const { panelId, attachId } = msg;
        pty.onData((data) => send(ws, { type: "term.data", panelId, attachId, data }));
        // A tmux client only exits on its own when its session ended: the process exited (`exit`, a
        // crash) or the panel was closed elsewhere. panelEnded removes the panel in the first case.
        pty.onExit(() => {
          if (ptys.get(msg.panelId) !== pty) return; // replaced or detached on purpose
          ptys.delete(msg.panelId);
          void panelEnded(msg.panelId).catch(() => {});
        });
        return;
      }
      case "term.detach": {
        const pty = ptys.get(msg.panelId);
        ptys.delete(msg.panelId);
        pty?.kill();
        return;
      }
      case "term.input":
        ptys.get(msg.panelId)?.write(msg.data);
        return;
      case "term.resize":
        if (msg.cols > 0 && msg.rows > 0) ptys.get(msg.panelId)?.resize(msg.cols, msg.rows);
        return;
    }
  }

  private broadcast(m: ServerMsg) {
    for (const ws of this.clients.keys()) send(ws, m);
  }

  /** Detach every browser client. Panel processes keep running in tmux. */
  detachAll() {
    for (const ptys of this.clients.values()) for (const pty of ptys.values()) pty.kill();
  }
}

function send(ws: WebSocket, m: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
}
