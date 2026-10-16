import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import type { ProviderId } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { providerLabel } from "../util.ts";
import { Composer, Select } from "./Composer.tsx";
import { FolderMenu } from "./FolderMenu.tsx";

export function Home() {
  const { projects, providers, picking } = useStore();
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!projects.some((p) => p.id === selected)) setSelected(projects[0]?.id ?? "");
  }, [projects, selected]);

  const project = projects.find((p) => p.id === selected);

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
        <FolderMenu label="Add project" className="chip">
          <FolderPlus size={16} /> {picking ? "Choose a folder in the window that opened…" : "Add project"}
        </FolderMenu>
      </div>

    </div>
  );
}
