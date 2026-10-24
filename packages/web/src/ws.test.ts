import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** A stand-in browser WebSocket: records what's sent, opens and closes when the test says. */
class FakeSocket {
  static last: FakeSocket;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.();
  }
}

let socket: typeof import("./ws.ts").socket;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "rails.test" });
  ({ socket } = await import("./ws.ts"));
});

afterAll(() => {
  socket.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("socket", () => {
  it("sends while connected", () => {
    socket.connect();
    FakeSocket.last.onopen?.();
    socket.send({ type: "term.input", panelId: "p", data: "a" });
    expect(FakeSocket.last.sent).toEqual([JSON.stringify({ type: "term.input", panelId: "p", data: "a" })]);
  });

  it("drops what's sent while disconnected, so keys never reach an agent late", () => {
    FakeSocket.last.close();
    socket.send({ type: "term.input", panelId: "p", data: "y\r" });
    socket.send({ type: "term.resize", panelId: "p", cols: 80, rows: 24 });
    vi.runOnlyPendingTimers(); // reconnects
    const next = FakeSocket.last;
    next.onopen?.();
    expect(next.sent).toEqual([]);
  });
});
