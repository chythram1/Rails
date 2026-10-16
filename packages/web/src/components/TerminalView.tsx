import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { socket } from "../ws.ts";

const THEME = {
  background: "#121212",
  foreground: "#ececec",
  cursor: "#ececec",
  selectionBackground: "#3a3a3a",
};

interface Props {
  panelId: string;
  /** Focus the terminal whenever this becomes true (the panel became active). */
  focused: boolean;
  onExited(): void;
}

/**
 * A browser terminal attached to a panel's tmux session. The server gives every attached terminal its
 * own tmux client, so this only streams bytes and reports its size.
 */
export function TerminalView({ panelId, focused, onExited }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(null);
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;

  useEffect(() => {
    const t = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: THEME,
      scrollback: 0, // tmux keeps the history; the mouse wheel scrolls it
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el.current!);
    term.current = t;

    const fitNow = () => {
      if (!el.current?.clientWidth || !el.current.clientHeight) return; // hidden
      const { cols, rows } = t;
      fit.fit();
      if (t.cols !== cols || t.rows !== rows) socket.send({ type: "term.resize", panelId, cols: t.cols, rows: t.rows });
    };
    const attach = () => {
      fitNow();
      t.reset(); // tmux redraws the whole screen on attach
      socket.send({ type: "term.attach", panelId, cols: t.cols, rows: t.rows });
    };

    const offData = socket.on((m) => {
      if (m.type === "term.data" && m.panelId === panelId) t.write(m.data);
      else if (m.type === "term.exited" && m.panelId === panelId) exitedRef.current();
    });
    const offConn = socket.onConnection((up) => up && attach());
    if (socket.connected) attach();
    const input = t.onData((data) => socket.send({ type: "term.input", panelId, data }));

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitNow);
    });
    observer.observe(el.current!);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      input.dispose();
      offData();
      offConn();
      socket.send({ type: "term.detach", panelId });
      t.dispose();
    };
  }, [panelId]);

  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  return <div className="term-host" ref={el} />;
}
