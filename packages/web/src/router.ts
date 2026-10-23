import type { McpAppId } from "@rails/shared";
import { useEffect, useState } from "react";

export type Route =
  /** Home. `promptId` asks it to fill in that saved prompt (Customize's "Use on Home"). */
  | { name: "home"; promptId?: string }
  /** A project's workspace. `openKey` asks it to open (or focus) that session's panel. */
  | { name: "workspace"; projectId: string; openKey?: string }
  /**
   * Sprockets (ADR 0005): the list, the creator (`new`), one Sprocket's chat or its settings beside it. The chat is its
   * direct chat, or with `project` its project's chat (ADR 0021). `team` is a team chat (ADR 0022), by its id.
   */
  | { name: "sprockets"; view: "list" | "new" | "chat" | "settings" | "team" | "teamSettings"; id?: string; project?: boolean }
  /**
   * Customize (ADR 0025): a tab (connectors, skills, prompts) of cards, or one thing open: a server, skill or prompt
   * of yours by id, or a connector (shared CONNECTORS) not added yet by its catalog id.
   */
  | { name: "customize"; view: "home" | "connector" | "mcp" | "skill" | "prompt"; tab: CustomizeTab; id?: string }
  /** A service's shared app (Google's): the steps to register it, and its client ID and secret. */
  | { name: "customize"; view: "app"; tab: "connectors"; app: McpAppId }
  /** Something new in Customize, not created until the user says so. */
  | { name: "customize"; view: "new"; tab: CustomizeTab; draft: CustomizeDraft }
  /** Automate (ADR 0032): the list of automations, a new one (not created until Create), or one by id. */
  | { name: "automate"; view: "list" | "new" }
  | { name: "automate"; view: "item"; id: string };

export type CustomizeTab = "connectors" | "skills" | "prompts";
/** What a new item in Customize is: a skill, a prompt, or a custom server with a URL or a command. */
export type CustomizeDraft = "skill" | "prompt" | "http" | "stdio";
const DRAFT_TABS: Record<CustomizeDraft, CustomizeTab> = { skill: "skills", prompt: "prompts", http: "connectors", stdio: "connectors" };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  if (parts[0] === "p" && parts[1] && parts[2] === "s" && parts[3]) return { name: "workspace", projectId: parts[1], openKey: parts[3] };
  if (parts[0] === "p" && parts[1]) return { name: "workspace", projectId: parts[1] };
  if (parts[0] === "sprockets") {
    if (parts[1] === "new") return { name: "sprockets", view: "new" };
    if (parts[1] === "teams" && parts[2]) return { name: "sprockets", view: parts[3] === "settings" ? "teamSettings" : "team", id: parts[2] };
    const project = parts[2] === "project";
    const rest = project ? parts[3] : parts[2];
    if (parts[1] && rest === "settings") return { name: "sprockets", view: "settings", id: parts[1], ...(project ? { project } : {}) };
    if (parts[1]) return { name: "sprockets", view: "chat", id: parts[1], ...(project ? { project } : {}) };
    return { name: "sprockets", view: "list" };
  }
  if (parts[0] === "new" && parts[1]) return { name: "home", promptId: parts[1] };
  if (parts[0] === "customize") {
    if (parts[1] === "apps" && parts[2] === "google") return { name: "customize", view: "app", tab: "connectors", app: "google" };
    // Under "new", apart from the items' own ids (a skill's id comes from its name, so one could be "new").
    if (parts[1] === "new" && parts[2] && Object.hasOwn(DRAFT_TABS, parts[2])) return { name: "customize", view: "new", tab: DRAFT_TABS[parts[2] as CustomizeDraft], draft: parts[2] as CustomizeDraft };
    if (parts[1] === "mcp" && parts[2]) return { name: "customize", view: "mcp", tab: "connectors", id: parts[2] };
    if (parts[1] === "connectors" && parts[2]) return { name: "customize", view: "connector", tab: "connectors", id: parts[2] };
    if (parts[1] === "skills" && parts[2]) return { name: "customize", view: "skill", tab: "skills", id: parts[2] };
    if (parts[1] === "prompts" && parts[2]) return { name: "customize", view: "prompt", tab: "prompts", id: parts[2] };
    if (parts[1] === "skills" || parts[1] === "prompts") return { name: "customize", view: "home", tab: parts[1] };
    return { name: "customize", view: "home", tab: "connectors" };
  }
  if (parts[0] === "automate") {
    if (parts[1] === "new") return { name: "automate", view: "new" };
    if (parts[1]) return { name: "automate", view: "item", id: parts[1] };
    return { name: "automate", view: "list" };
  }
  return { name: "home" };
}

export const href = {
  home: () => "#/",
  automate: () => "#/automate",
  newAutomation: () => "#/automate/new",
  automation: (id: string) => `#/automate/${encodeURIComponent(id)}`,
  /** Home with a saved prompt filled in. */
  homeWithPrompt: (promptId: string) => `#/new/${encodeURIComponent(promptId)}`,
  project: (projectId: string) => `#/p/${encodeURIComponent(projectId)}`,
  session: (projectId: string, key: string) => `#/p/${encodeURIComponent(projectId)}/s/${encodeURIComponent(key)}`,
  sprockets: () => "#/sprockets",
  newSprocket: () => "#/sprockets/new",
  /** A Sprocket's direct chat, or (`project`) its project's chat. */
  sprocket: (id: string, project = false) => `#/sprockets/${encodeURIComponent(id)}${project ? "/project" : ""}`,
  team: (id: string) => `#/sprockets/teams/${encodeURIComponent(id)}`,
  teamSettings: (id: string) => `#/sprockets/teams/${encodeURIComponent(id)}/settings`,
  sprocketSettings: (id: string, project = false) => `#/sprockets/${encodeURIComponent(id)}${project ? "/project" : ""}/settings`,
  customize: (tab: CustomizeTab = "connectors") => (tab === "connectors" ? "#/customize" : `#/customize/${tab}`),
  /** A connector not added yet (its page, with Connect). */
  connector: (id: string) => `#/customize/connectors/${encodeURIComponent(id)}`,
  mcpServer: (id: string) => `#/customize/mcp/${encodeURIComponent(id)}`,
  skill: (id: string) => `#/customize/skills/${encodeURIComponent(id)}`,
  prompt: (id: string) => `#/customize/prompts/${encodeURIComponent(id)}`,
  /** A service's shared app (its setup steps). */
  mcpApp: (id: McpAppId) => `#/customize/apps/${id}`,
  /** Something new, created only when the user says so. */
  newItem: (draft: CustomizeDraft) => `#/customize/new/${draft}`,
};

export function navigate(to: string) {
  location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
