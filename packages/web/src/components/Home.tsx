import { useEffect, useState } from "react";
import { IconFolderPlus as FolderPlus } from "@tabler/icons-react";
import type { ProviderId } from "@rails/shared";
import { api } from "../api.ts";
import { href, navigate } from "../router.ts";
import { useStore } from "../store.tsx";
import { providerLabel } from "../util.ts";
import { Composer } from "./Composer.tsx";
import { Dropdown } from "./Dropdown.tsx";
import { FolderMenu } from "./FolderMenu.tsx";
import { SavedPromptsMenu } from "./customize/SavedPromptsMenu.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";

export function Home({ promptId }: { promptId?: string }) {
  const { projects, providers, picking, agentProfiles, savedPrompts } = useStore();
  const [selected, setSelected] = useState("");
  const [provider, setProvider] = useState<ProviderId>("claude");
  /** The agent profile to start with (ADR 0020); "" is the agent's default. */
  const [profileId, setProfileId] = useState("");
  const [fill, setFill] = useState<{ text: string }>();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!projects.some((p) => p.id === selected)) setSelected(projects[0]?.id ?? "");
  }, [projects, selected]);

  // #/new/<promptId> (Customize's "Use on Home"): fill in that saved prompt, then drop it from the URL.
  useEffect(() => {
    if (!promptId || !savedPrompts) return;
    const prompt = savedPrompts.find((p) => p.id === promptId);
    if (prompt) setFill({ text: prompt.text });
    location.replace(href.home());
  }, [promptId, savedPrompts]);

  const project = projects.find((p) => p.id === selected);
  const profiles = (agentProfiles ?? []).filter((p) => p.agent === provider);
  const defaultProfile = profiles.find((p) => p.isDefault);
  // A profile for another agent (or deleted since) falls back to the default.
  const shownProfile = profiles.some((p) => p.id === profileId) ? profileId : "";

  /** Start the chosen agent's TUI with the prompt as its first message, in a new panel. */
  const start = async (text: string) => {
    if (!project) return;
    setError("");
    setStarting(true);
    try {
      await api.openPanel(project.id, { kind: provider, prompt: text, ...(shownProfile ? { profileId: shownProfile } : {}) });
      navigate(href.project(project.id));
    } catch (e: any) {
      setError(e.message);
      setStarting(false);
    }
  };

  return (
    <div className="page home">
      <p className="eyebrow">New chat</p>
      <h1 className="hero">Let's start building</h1>
      <Composer
        placeholder="What do you want to build?"
        onSubmit={(text) => void start(text)}
        autoFocus
        disabled={!project || starting}
        disabledReason={!project ? "Add a project to start a chat" : "Starting…"}
        fill={fill}
      >
        <Dropdown
          plain
          label="Project"
          value={selected}
          onChange={setSelected}
          options={projects.length ? projects.map((p) => ({ value: p.id, label: p.name })) : [{ value: "", label: "No project" }]}
        />
        <Dropdown
          plain
          label="Agent"
          value={provider}
          onChange={(v) => setProvider(v as ProviderId)}
          options={(providers.length ? providers : [{ id: "claude" as const, installed: true }]).map((p) => ({
            value: p.id,
            label: providerLabel[p.id] + (p.installed ? "" : " (not installed)"),
            icon: <ProviderIcon provider={p.id} />,
            disabled: !p.installed,
          }))}
        />
        {profiles.length > 0 && (
          <Dropdown
            plain
            label="Profile"
            value={shownProfile}
            onChange={setProfileId}
            options={[
              { value: "", label: defaultProfile ? defaultProfile.name : "No profile" },
              ...profiles.filter((p) => !p.isDefault).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        )}
        <SavedPromptsMenu onPick={(text) => setFill({ text })} />
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
