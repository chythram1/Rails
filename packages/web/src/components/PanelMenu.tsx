import { useEffect, useRef, useState } from "react";
import { Plus, SquareTerminal } from "lucide-react";
import type { PanelKind, ProviderId } from "@rails/shared";
import { useStore } from "../store.tsx";
import { providerLabel } from "../util.ts";
import { ProviderIcon } from "./ProviderIcon.tsx";

const AGENTS: ProviderId[] = ["claude", "codex", "pi"];

/** Icon for a panel kind: the agent's logo, or a terminal glyph for shells. */
export function PanelIcon({ kind }: { kind: PanelKind }) {
  return kind === "shell" ? <SquareTerminal size={15} className="shell-icon" aria-label="Shell" /> : <ProviderIcon provider={kind} />;
}

/** The "+" that starts a new agent or shell. The menu is fixed-positioned so pane headers can't clip it. */
export function PanelMenu({ onPick }: { onPick(kind: PanelKind): void }) {
  const { providers } = useStore();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [at]);

  const pick = (kind: PanelKind) => {
    setAt(null);
    onPick(kind);
  };

  return (
    <>
      <button
        className="icon-btn"
        aria-label="New panel"
        title="New agent or shell"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: Math.min(r.left, innerWidth - 200), y: r.bottom + 4 });
        }}
      >
        <Plus size={16} />
      </button>
      {at && (
        <div className="menu" role="menu" ref={menu} style={{ left: at.x, top: at.y }}>
          {AGENTS.map((id) => {
            const ok = providers.find((p) => p.id === id)?.installed ?? false;
            return (
              <button key={id} role="menuitem" disabled={!ok} onClick={() => pick(id)}>
                <PanelIcon kind={id} /> {providerLabel[id]}
                {!ok && <span className="muted small"> not installed</span>}
              </button>
            );
          })}
          <button role="menuitem" onClick={() => pick("shell")}>
            <PanelIcon kind="shell" /> Shell
          </button>
        </div>
      )}
    </>
  );
}
