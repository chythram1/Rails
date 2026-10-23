import type { IPty } from "node-pty";
import type WebSocket from "ws";
import type { ClientMsg, ServerMsg } from "@rails/shared";
import { watchBusy } from "./activity.ts";
import { onCustomizeChanged } from "./customize.ts";
import { onAutomationsChanged } from "./automations.ts";
import { panels } from "./db.ts";
import { onPanelsChanged, panelEnded } from "./panels.ts";
import { attentionList, onAttention } from "./bridge/index.ts";
import { onOverlaps, overlapList } from "./overlaps.ts";
import { onHandoffsChanged } from "./handoffs.ts";
import { onOwnersChanged } from "./owners.ts";
import { onDecisionsChanged } from "./decisions.ts";
import { onModelsChanged, onSignIn } from "./models.ts";
import { getProfile, onProfileChanged } from "./profile.ts";
import { onActivity, onTyping } from "./runs.ts";
import { onSprocketsChanged } from "./sprockets.ts";
import * as tmux from "./tmux.ts";

/**
 * Connects browser terminals to panels. Every attached panel gets its own tmux client (a PTY) sized to
 * that browser, so devices share the same process. Closing a browser only detaches its clients.
 */
export class TerminalHub {
  private clients = new Map<WebSocket, Map<string, IPty>>();
  /** Busy panels (see activity.ts), watched while any browser is connected. */
  private busy: string[] = [];
  private stopWatching?: () => void;

  constructor() {
    onPanelsChanged((projectId) => this.broadcast({ type: "panels.changed", projectId }));
    onSprocketsChanged(() => this.broadcast({ type: "sprockets.changed" }));
    onHandoffsChanged(() => this.broadcast({ type: "sprockets.changed" })); // they show in the Coordinator's panel
    onOwnersChanged(() => this.broadcast({ type: "sprockets.changed" })); // so do owners
    onCustomizeChanged(() => this.broadcast({ type: "customize.changed" }));
    onAutomationsChanged(() => this.broadcast({ type: "automations.changed" }));
    onTyping((sprocketId, chatId, text) => this.broadcast({ type: "sprockets.typing", sprocketId, chatId, text }));
    onActivity((sprocketId, chatId, step, summary) => this.broadcast({ type: "sprockets.activity", sprocketId, chatId, step, summary }));
    onModelsChanged(() => this.broadcast({ type: "models.changed" }));
    onDecisionsChanged(() => this.broadcast({ type: "decisions.changed" }));
    onSignIn((signIn) => this.broadcast({ type: "models.signIn", signIn }));
    onProfileChanged((profile) => this.broadcast({ type: "profile.changed", profile }));
    onAttention((list) => this.broadcast({ type: "panels.attention", panels: list }));
    onOverlaps((overlaps) => this.broadcast({ type: "panels.overlaps", overlaps }));
  }

  connect(ws: WebSocket) {
    this.clients.set(ws, new Map());
    send(ws, { type: "panels.busy", panelIds: this.busy });
    send(ws, { type: "panels.attention", panels: attentionList() });
    send(ws, { type: "panels.overlaps", overlaps: overlapList() });
    send(ws, { type: "profile.changed", profile: getProfile() });
    this.stopWatching ??= watchBusy((ids) => {
      this.busy = ids;
      this.broadcast({ type: "panels.busy", panelIds: ids });
    });
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
      if (this.clients.size === 0) {
        this.stopWatching?.();
        this.stopWatching = undefined;
        this.busy = [];
      }
    });
  }

  private handle(ws: WebSocket, msg: ClientMsg) {
    const ptys = this.clients.get(ws)!;
    switch (msg.type) {
      case "term.attach": {
        const { panelId, attachId } = msg;
        ptys.get(panelId)?.kill();
        if (!panels.get(panelId)) return; // closed meanwhile; panels.changed updates the browser
        const pty = tmux.attach(panelId, msg.cols, msg.rows);
        ptys.set(panelId, pty);
        pty.onData((data) => send(ws, { type: "term.data", panelId, attachId, data }));
        // A tmux client only exits on its own when its session ended: the process exited (`exit`, a
        // crash) or the panel was closed elsewhere. panelEnded removes the panel in the first case.
        pty.onExit(() => {
          if (ptys.get(panelId) !== pty) return; // replaced or detached on purpose
          ptys.delete(panelId);
          void panelEnded(panelId).catch(() => {});
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

  /** Close every browser connection (after signing out everywhere): they reconnect, and only a browser
   * with the new token gets back in. Panel processes keep running in tmux. */
  disconnectAll() {
    for (const ws of this.clients.keys()) ws.close(4001, "Signed out");
  }

  /** Detach every browser client. Panel processes keep running in tmux. */
  detachAll() {
    for (const ptys of this.clients.values()) for (const pty of ptys.values()) pty.kill();
  }
}

function send(ws: WebSocket, m: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
}
