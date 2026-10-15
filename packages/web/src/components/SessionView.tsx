import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import { parseSessionKey, type LiveStatus, type Message, type PermissionMode, type PermissionRequest } from "@rails/shared";
import { api } from "../api.ts";
import { useStore } from "../store.tsx";
import { providerLabel, tildify } from "../util.ts";
import { socket } from "../ws.ts";
import { Composer, MODE_OPTIONS, Select } from "./Composer.tsx";
import { GitPanel } from "./GitPanel.tsx";
import { MessageList } from "./MessageList.tsx";
import { ProviderBadge } from "./ProviderBadge.tsx";

export function SessionView({ projectId, sessionKey }: { projectId: string; sessionKey: string }) {
  const { provider, id } = parseSessionKey(sessionKey);
  const { sessions, providers, projects } = useStore();
  const summary = sessions[projectId]?.find((s) => s.key === sessionKey);
  const project = projects.find((p) => p.id === projectId);
  const canLive = providers.find((p) => p.id === provider)?.live ?? false;

  const [history, setHistory] = useState<Message[] | null>(null);
  const [liveMsgs, setLiveMsgs] = useState<Message[]>([]);
  const [status, setStatus] = useState<LiveStatus>("stopped");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [error, setError] = useState("");
  const [gitOpen, setGitOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.messages(provider, id).then(setHistory, (e) => setError(e.message));
  }, [provider, id]);

  useEffect(() => {
    const off = socket.on((m) => {
      if (m.type === "error") return void (!m.clientRef && setError(m.message));
      if (!("key" in m) || m.key !== sessionKey) return;
      switch (m.type) {
        case "snapshot":
          setLiveMsgs(m.messages);
          setStatus(m.status);
          setMode(m.mode);
          setPending(m.pending);
          break;
        case "message":
          setLiveMsgs((l) => [...l, m.message]);
          break;
        case "status":
          setStatus(m.status);
          if (m.error) setError(m.error);
          break;
        case "mode":
          setMode(m.mode);
          break;
        case "permission.request":
          setPending((p) => [...p, m.request]);
          break;
        case "permission.resolved":
          setPending((p) => p.filter((r) => r.id !== m.requestId));
          break;
      }
    });
    const unsub = socket.subscribe(sessionKey);
    return () => {
      off();
      unsub();
    };
  }, [sessionKey]);

  const messages = useMemo(() => {
    const seen = new Set((history ?? []).map((m) => m.id));
    return [...(history ?? []), ...liveMsgs.filter((m) => !seen.has(m.id))];
  }, [history, liveMsgs]);

  // Stick to the bottom while new messages arrive, unless the user scrolled up.
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  const isLive = status !== "stopped" && status !== "error";
  const running = status === "running" || status === "starting";

  const send = (text: string) => {
    setError("");
    socket.send({ type: "send", key: sessionKey, projectId, text, mode });
  };

  const changeMode = (m: PermissionMode) => {
    setMode(m);
    if (isLive) socket.send({ type: "setMode", key: sessionKey, mode: m });
  };

  return (
    <div className="session">
      <div className="session-main">
        <header className="session-head">
          <div className="grow min0">
            <h1 className="truncate">{summary?.title ?? "Session"}</h1>
            <div className="muted small truncate">
              <ProviderBadge provider={provider} /> {providerLabel[provider]} · {tildify(summary?.cwd ?? project?.path ?? "")}
            </div>
          </div>
          <span className={"status s-" + status}>{statusLabel(status, canLive)}</span>
          {isLive && (
            <button className="btn small" onClick={() => socket.send({ type: "stop", key: sessionKey })}>
              Stop agent
            </button>
          )}
          <button className={"icon-btn" + (gitOpen ? " active" : "")} aria-label="Toggle git panel" aria-pressed={gitOpen} title="Git" onClick={() => setGitOpen((o) => !o)}>
            <GitBranch size={18} />
          </button>
        </header>

        <div
          className="scroller"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="thread">
            {history === null && !error && <p className="muted">Loading transcript…</p>}
            <MessageList messages={messages} />
            {pending.map((r) => (
              <PermissionCard key={r.id} req={r} onAnswer={(allow) => socket.send({ type: "permission", key: sessionKey, requestId: r.id, allow })} />
            ))}
            {running && <div className="typing" aria-live="polite">Working…</div>}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        </div>

        <div className="thread-composer">
          <Composer
            placeholder={isLive ? "Message the agent" : "Send a message to resume this session"}
            onSubmit={send}
            disabled={!canLive}
            disabledReason={`Read-only: rails can't run ${providerLabel[provider]} sessions live yet`}
            running={running}
            onInterrupt={() => socket.send({ type: "interrupt", key: sessionKey })}
          >
            {canLive && <Select label="Permissions" value={mode} onChange={changeMode} options={MODE_OPTIONS} />}
          </Composer>
        </div>
      </div>
      {gitOpen && <GitPanel projectId={projectId} refreshKey={status} onClose={() => setGitOpen(false)} />}
    </div>
  );
}

function statusLabel(s: LiveStatus, canLive: boolean) {
  switch (s) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "idle":
      return "Live";
    case "error":
      return "Error";
    default:
      return canLive ? "Not running" : "Read-only";
  }
}

function PermissionCard({ req, onAnswer }: { req: PermissionRequest; onAnswer(allow: boolean): void }) {
  return (
    <div className="perm" role="group" aria-label={`Permission request for ${req.toolName}`}>
      <div className="perm-title">
        Allow <strong>{req.toolName}</strong>?
      </div>
      <pre className="code">{JSON.stringify(req.input, null, 2)}</pre>
      <div className="perm-actions">
        <button className="btn" onClick={() => onAnswer(false)}>Deny</button>
        <button className="btn primary" onClick={() => onAnswer(true)}>Allow</button>
      </div>
    </div>
  );
}
