import type { IPty } from "node-pty";
import type WebSocket from "ws";
import type { ClientMsg, ServerMsg } from "@rails/shared";
import { panels } from "./db.ts";
import { onPanelsChanged } from "./panels.ts";
import * as tmux from "./tmux.ts";

const EXIT_POLL_MS = 2000;

/**
 * Connects browser terminals to panels. Every attached panel gets its own tmux client (a PTY) sized to
 * that browser, so devices share the same process. Closing a browser only detaches its clients.
 */
export class TerminalHub {
  private clients = new Map<WebSocket, Map<string, IPty>>();
  private dead = new Set<string>();
  private poll?: NodeJS.Timeout;

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
      this.updatePolling();
    });
  }

  private handle(ws: WebSocket, msg: ClientMsg) {
    const ptys = this.clients.get(ws)!;
    switch (msg.type) {
      case "term.attach": {
        ptys.get(msg.panelId)?.kill();
        if (!panels.get(msg.panelId)) return send(ws, { type: "term.exited", panelId: msg.panelId });
        const pty = tmux.attach(msg.panelId, msg.cols, msg.rows);
        ptys.set(msg.panelId, pty);
        pty.onData((data) => send(ws, { type: "term.data", panelId: msg.panelId, data }));
        // The tmux client only exits on its own when the session is gone (panel closed elsewhere).
        pty.onExit(() => {
          if (ptys.get(msg.panelId) !== pty) return; // replaced or detached on purpose
          ptys.delete(msg.panelId);
          send(ws, { type: "term.exited", panelId: msg.panelId });
        });
        this.updatePolling();
        return;
      }
      case "term.detach": {
        const pty = ptys.get(msg.panelId);
        ptys.delete(msg.panelId);
        pty?.kill();
        this.updatePolling();
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

  /** Poll tmux for exited processes, but only while some terminal is attached. */
  private updatePolling() {
    const attached = [...this.clients.values()].some((m) => m.size > 0);
    if (attached && !this.poll) this.poll = setInterval(() => void this.checkExits(), EXIT_POLL_MS);
    if (!attached && this.poll) {
      clearInterval(this.poll);
      this.poll = undefined;
    }
  }

  private async checkExits() {
    const states = await tmux.sessionStates();
    for (const [ws, ptys] of this.clients) {
      for (const panelId of ptys.keys()) {
        const dead = states.get(panelId)?.dead ?? false;
        if (dead && !this.dead.has(panelId)) send(ws, { type: "term.exited", panelId });
      }
    }
    this.dead = new Set([...states].filter(([, s]) => s.dead).map(([id]) => id));
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
