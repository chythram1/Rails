import type { ClientMsg, ServerMsg } from "@rails/shared";

type Listener = (m: ServerMsg) => void;

/** Single shared WebSocket with auto-reconnect. Terminals re-attach themselves via onConnection. */
class Socket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private connListeners = new Set<(up: boolean) => void>();
  private retry = 0;
  /** Signed out: don't reconnect until connect() is called again (after signing in). */
  private stopped = false;
  connected = false;

  connect() {
    this.stopped = false;
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      this.ws = undefined;
      this.setConnected(false);
      if (!this.stopped) setTimeout(() => !this.stopped && this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  /** Close the connection for good (signing out): the server keeps an open socket authorized otherwise. */
  disconnect() {
    this.stopped = true;
    this.ws?.close();
  }

  private setConnected(up: boolean) {
    this.connected = up;
    for (const l of this.connListeners) l(up);
  }

  /**
   * Sent now, or not at all: nothing is kept for later. Keys typed into a dead connection would reach the agent
   * minutes later, in whatever state it's in by then (a "y" at a prompt that changed meanwhile). The server drops a
   * socket's terminals when it closes, and terminals attach again, at their current size, on reconnect.
   */
  send(m: ClientMsg) {
    if (this.connected) this.ws?.send(JSON.stringify(m));
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  onConnection(l: (up: boolean) => void) {
    this.connListeners.add(l);
    return () => void this.connListeners.delete(l);
  }
}

export const socket = new Socket();
