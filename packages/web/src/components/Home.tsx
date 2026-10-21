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
  /** An agent's id, or `profile:<id>` for an agent profile (ADR 0018). */
  const [agent, setAgent] = useState<string>("claude");
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
  const profile = agent.startsWith("profile:") ? agentProfiles?.find((p) => `profile:${p.id}` === agent) : undefined;
  // A profile deleted (maybe on another device) while it was picked: back to Claude Code.
  useEffect(() => {
    if (agent.startsWith("profile:") && agentProfiles && !profile) setAgent("claude");
  }, [agent, agentProfiles, profile]);
  const defaultNote = (id: ProviderId) => {
    const d = agentProfiles?.find((p) => p.provider === id && p.isDefault);
    return d ? ` · ${d.name}` : "";
  };
  const provider: ProviderId = profile ? profile.provider : agent.startsWith("profile:") ? "claude" : (agent as ProviderId);

  /** Start the chosen agent's TUI with the prompt as its first message, in a new panel. */
  const start = async (text: string) => {
    if (!project) return;
    setError("");
    setStarting(true);
    try {
      await api.openPanel(project.id, { kind: provider, prompt: text, agentProfileId: profile?.id });
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
          value={agent}
          onChange={setAgent}
          options={[
            ...(providers.length ? providers : [{ id: "claude" as const, installed: true }]).map((p) => ({
              value: p.id,
              // An agent starts with its default profile, if it has one.
              label: providerLabel[p.id] + (p.installed ? defaultNote(p.id) : " (not installed)"),
              icon: <ProviderIcon provider={p.id} />,
              disabled: !p.installed,
            })),
            ...(agentProfiles ?? []).map((p) => {
              const installed = providers.find((x) => x.id === p.provider)?.installed ?? false;
              return {
                value: `profile:${p.id}`,
                label: p.name + (installed ? "" : " (not installed)"),
                group: "Agent profiles",
                icon: <ProviderIcon provider={p.provider} />,
                disabled: !installed,
              };
            }),
          ]}
        />
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
