import { useEffect, useMemo, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { ProviderId } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { providerLabel, tildify, timeAgo } from "../util.ts";
import { Composer, Select } from "./Composer.tsx";
import { ProviderBadge } from "./ProviderBadge.tsx";

export function Home() {
  const { projects, providers, sessions, picking, addProject } = useStore();
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!projects.some((p) => p.id === selected)) setSelected(projects[0]?.id ?? "");
  }, [projects, selected]);

  const project = projects.find((p) => p.id === selected);

  const recent = useMemo(() => {
    return projects
      .flatMap((p) => (sessions[p.id] ?? []).map((s) => ({ ...s, projectId: p.id })))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 9);
  }, [projects, sessions]);

  /** Start the chosen agent's TUI with the prompt as its first message, in a new panel. */
  const start = async (text: string) => {
    if (!project) return;
    setError("");
    setStarting(true);
    try {
      await api.openPanel(project.id, { kind: provider, prompt: text });
      navigate(href.project(project.id));
    } catch (e: any) {
      setError(e.message);
      setStarting(false);
    }
  };

  return (
    <div className="page">
      <h1 className="hero">Let's start building</h1>
      <Composer
        placeholder="What do you want to build?"
        onSubmit={(text) => void start(text)}
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
          options={(providers.length ? providers : [{ id: "claude" as const, installed: true }]).map((p) => ({
            value: p.id,
            label: providerLabel[p.id] + (p.installed ? "" : " (not installed)"),
            disabled: !p.installed,
          }))}
        />
      </Composer>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="chips">
        <button className="chip" disabled={picking} onClick={() => void addProject()}>
          <FolderPlus size={16} /> {picking ? "Choose a folder in the window that opened…" : "Add project"}
        </button>
        {project && <span className="chip static" title={project.path}>{tildify(project.path)}</span>}
      </div>

      <section className="section">
        <h2>Recent sessions</h2>
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
                  {s.panelId && <span className="dot live" aria-label="open in a panel" />}
                </div>
                <div className="card-title">{s.title}</div>
                <div className="muted small">{timeAgo(s.updatedAt)}</div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
