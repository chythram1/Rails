import { useEffect, useMemo, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { PermissionMode, ProviderId } from "@rails/shared";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { providerLabel, randomId, tildify, timeAgo } from "../util.ts";
import { socket } from "../ws.ts";
import { AddProjectDialog } from "./AddProjectDialog.tsx";
import { Composer, MODE_OPTIONS, Select } from "./Composer.tsx";
import { ProviderBadge } from "./ProviderBadge.tsx";

export function Home({ projectId }: { projectId?: string }) {
  const { projects, providers, sessions } = useStore();
  const [selected, setSelected] = useState(projectId ?? "");
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [mode, setMode] = useState<PermissionMode>("default");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (projectId) setSelected(projectId);
    else if (!projects.some((p) => p.id === selected)) setSelected(projects[0]?.id ?? "");
  }, [projectId, projects, selected]);

  const project = projects.find((p) => p.id === selected);

  const recent = useMemo(() => {
    const ids = projectId ? [projectId] : projects.map((p) => p.id);
    return ids
      .flatMap((id) => (sessions[id] ?? []).map((s) => ({ ...s, projectId: id })))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 9);
  }, [projects, sessions, projectId]);

  const start = (text: string) => {
    if (!project) return;
    const clientRef = randomId();
    setError("");
    setStarting(true);
    const off = socket.on((m) => {
      if (m.type === "session.started" && m.clientRef === clientRef) {
        off();
        navigate(href.session(m.projectId, m.key));
      } else if (m.type === "error" && m.clientRef === clientRef) {
        off();
        setStarting(false);
        setError(m.message);
      }
    });
    socket.send({ type: "start", clientRef, projectId: project.id, provider, text, mode });
  };

  return (
    <div className="page">
      <h1 className="hero">{project && projectId ? project.name : "Let's start building"}</h1>
      <Composer
        placeholder="What do you want to build?"
        onSubmit={start}
        autoFocus
        disabled={!project || starting}
        disabledReason={!project ? "Add a project to start a chat" : "Starting…"}
      >
        <Select
          label="Project"
          value={selected}
          onChange={setSelected}
          options={projects.length ? projects.map((p) => ({ value: p.id, label: p.name })) : [{ value: "", label: "No project" }]}
        />
        <Select<ProviderId>
          label="Agent"
          value={provider}
          onChange={setProvider}
          options={(providers.length ? providers : [{ id: "claude" as const, live: true }]).map((p) => ({
            value: p.id,
            label: providerLabel[p.id] + (p.live ? "" : " (soon)"),
            disabled: !p.live,
          }))}
        />
        <Select<PermissionMode> label="Permissions" value={mode} onChange={setMode} options={MODE_OPTIONS} />
      </Composer>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="chips">
        <button className="chip" onClick={() => setAdding(true)}>
          <FolderPlus size={16} /> Add project
        </button>
        {project && <span className="chip static" title={project.path}>{tildify(project.path)}</span>}
      </div>

      <section className="section">
        <h2>{projectId ? "Sessions" : "Recent sessions"}</h2>
        {recent.length === 0 ? (
          <p className="muted">
            {projects.length ? "No agent sessions found for your projects yet." : "Add a project folder and rails will find its Claude Code, Codex and pi sessions."}
          </p>
        ) : (
          <div className="cards">
            {recent.map((s) => (
              <a key={s.key} className="card" href={href.session(s.projectId, s.key)}>
                <div className="card-top">
                  <ProviderBadge provider={s.provider} />
                  <span className="muted small">{projects.find((p) => p.id === s.projectId)?.name}</span>
                  {s.liveStatus && <span className={"dot " + (s.liveStatus === "running" ? "running" : "live")} aria-label="live" />}
                </div>
                <div className="card-title">{s.title}</div>
                <div className="muted small">{timeAgo(s.updatedAt)}</div>
              </a>
            ))}
          </div>
        )}
      </section>
      {adding && <AddProjectDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
