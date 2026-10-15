import type { ClientMsg, ServerMsg } from "@rails/shared";

type Listener = (m: ServerMsg) => void;

/** Single shared WebSocket with auto-reconnect; re-subscribes to sessions after reconnecting. */
class Socket {
  private ws?: WebSocket;
  private listeners = new Set<Listener>();
  private connListeners = new Set<(up: boolean) => void>();
  private subs = new Map<string, number>(); // key -> refcount
  private queue: ClientMsg[] = [];
  private retry = 0;
  connected = false;

  connect() {
    if (this.ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      for (const key of this.subs.keys()) this.raw({ type: "subscribe", key });
      for (const m of this.queue.splice(0)) this.raw(m);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMsg;
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      this.ws = undefined;
      this.setConnected(false);
      setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  private setConnected(up: boolean) {
    this.connected = up;
    for (const l of this.connListeners) l(up);
  }

  private raw(m: ClientMsg) {
    this.ws?.send(JSON.stringify(m));
  }

  send(m: ClientMsg) {
    if (this.connected) this.raw(m);
    else this.queue.push(m);
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  onConnection(l: (up: boolean) => void) {
    this.connListeners.add(l);
    return () => void this.connListeners.delete(l);
  }

  subscribe(key: string) {
    const n = this.subs.get(key) ?? 0;
    this.subs.set(key, n + 1);
    if (n === 0 && this.connected) this.raw({ type: "subscribe", key });
    return () => {
      const c = (this.subs.get(key) ?? 1) - 1;
      if (c > 0) return void this.subs.set(key, c);
      this.subs.delete(key);
      if (this.connected) this.raw({ type: "unsubscribe", key });
    };
  }
}

export const socket = new Socket();
