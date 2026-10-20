// The agents' panels, through the run's tmux server: reading their screens, typing as the user, and getting each
// one ready (its folder-trust prompt, its model, pi's approval guard). The model is picked by its label on screen,
// never by position: list orders change between versions (one run picked a heavyweight model by counting).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AgentConfig } from "./run.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Panes {
  constructor(private home: string) {}

  private tmux(...args: string[]): string {
    return execFileSync("tmux", ["-S", join(this.home, "tmux.sock"), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  }

  /** The panel's screen, without blank lines. */
  screen(panelId: string): string {
    try {
      return this.tmux("capture-pane", "-p", "-J", "-t", `p-${panelId}`)
        .split("\n")
        .filter((l) => l.trim())
        .join("\n");
    } catch {
      return "";
    }
  }

  keys(panelId: string, ...keys: string[]): void {
    this.tmux("send-keys", "-t", `p-${panelId}`, ...keys);
  }

  /** Type text and press Enter, as the user would. */
  async type(panelId: string, text: string): Promise<void> {
    this.tmux("send-keys", "-t", `p-${panelId}`, "-l", text);
    await sleep(400);
    this.keys(panelId, "Enter");
  }

  async waitFor(panelId: string, re: RegExp, ms = 20_000): Promise<boolean> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (re.test(this.screen(panelId))) return true;
      await sleep(400);
    }
    return false;
  }

  /** The line the agent's picker has selected. */
  private selected(panelId: string, marker: RegExp): string {
    return this.screen(panelId).split("\n").find((l) => marker.test(l)) ?? "";
  }

  /** Move a picker's selection to the line that shows `label`. */
  private async select(panelId: string, marker: RegExp, label: RegExp): Promise<boolean> {
    for (const key of ["Down", "Up"])
      for (let i = 0; i < 25; i++) {
        if (label.test(this.selected(panelId, marker))) return true;
        this.keys(panelId, key);
        await sleep(150);
      }
    return label.test(this.selected(panelId, marker));
  }

  /** Get a fresh agent panel ready: trust the folder, pick the model, and (pi) turn its approval guard off. */
  async prepare(panelId: string, agent: AgentConfig): Promise<string[]> {
    const done: string[] = [];
    if (agent.kind === "claude" && (await this.waitFor(panelId, /Yes, I trust this folder|❯\s*$|auto mode|for shortcuts/))) {
      if (/Yes, I trust this folder/.test(this.screen(panelId))) {
        // Move to "Yes" by what's selected on screen, then confirm: "No, exit" comes first (2.1.304), and a key sent
        // before the menu takes input is lost, so a blind Down + Enter can pick "No" and close the panel.
        await sleep(500);
        if (!(await this.select(panelId, /❯/, /❯\s*(\d+\.\s*)?Yes, I trust this folder/))) throw new Error("Couldn't select \"Yes, I trust this folder\" in Claude Code.");
        this.keys(panelId, "Enter");
        if (!(await this.waitFor(panelId, /auto mode|for shortcuts/, 15_000))) throw new Error(`Claude Code didn't open after trusting the folder. Its screen:\n${this.screen(panelId)}`);
        done.push("trusted the folder");
      }
    }
    // Codex shows its main screen for a while (12 s wasn't always enough) before asking to trust a new folder: wait
    // for the question itself. In a folder it already trusts, this waits out the 30 s.
    if (agent.kind === "codex" && (await this.waitFor(panelId, /Trust this folder\?/, 30_000))) {
      this.keys(panelId, "Enter");
      done.push("trusted the folder");
    }
    const ready = { claude: /auto mode|for shortcuts|❯/, codex: /Ask Codex to do anything/, pi: /\(\w[\w-]*\) [\w.-]+/ }[agent.kind];
    if (!(await this.waitFor(panelId, ready, 30_000))) throw new Error(`${agent.name} (${agent.kind}) didn't get ready. Its screen:\n${this.screen(panelId)}`);
    await sleep(1000);

    if (agent.model) {
      if (agent.kind === "claude") {
        await this.type(panelId, "/model");
        if (!(await this.waitFor(panelId, /Select model/))) throw new Error("Claude Code's model picker didn't open.");
        if (!(await this.select(panelId, /❯/, new RegExp(`\\d+\\.\\s+${escape(agent.model)}(\\s|$)`)))) {
          this.keys(panelId, "Escape");
          throw new Error(`Claude Code has no model labelled "${agent.model}".`);
        }
        this.keys(panelId, "s"); // this session only: the user's default stays
        if (!(await this.waitFor(panelId, new RegExp(`Set model to ${escape(agent.model)}`)))) throw new Error(`Claude Code didn't confirm ${agent.model}.`);
      } else if (agent.kind === "pi") {
        // "provider/id" when the id is under more than one provider: the picker shows "id [provider]", the status
        // line "(provider) id".
        const [provider, id] = agent.model.includes("/") ? agent.model.split("/", 2) : [undefined, agent.model];
        const by = provider ? escape(provider) : "[\\w-]+";
        await this.type(panelId, "/model");
        if (!(await this.waitFor(panelId, /Enter to select/))) throw new Error("pi's model picker didn't open.");
        this.tmux("send-keys", "-t", `p-${panelId}`, "-l", id); // its search: the list can be long with many providers
        await sleep(500);
        if (!(await this.select(panelId, /^\s*→/, new RegExp(`→\\s+(✓\\s+)?${escape(id)}\\s+\\[${by}\\]`)))) {
          this.keys(panelId, "Escape");
          throw new Error(`pi has no model labelled "${agent.model}".`);
        }
        this.keys(panelId, "Enter"); // this session only (Ctrl+S would make it pi's default)
        if (!(await this.waitFor(panelId, new RegExp(`\\(${by}\\) ${escape(id)} `)))) throw new Error(`pi didn't switch to ${agent.model}.`);
      } else if (!new RegExp(escape(agent.model), "i").test(this.screen(panelId))) {
        throw new Error(`Picking Codex's model isn't supported yet: leave "model" out to use its default.`);
      }
      done.push(`model ${agent.model}`);
    }

    if (agent.kind === "pi") {
      // The user's pi has a `guard` extension asking before every edit and command: off for the run (`/guard off`;
      // `/guard` alone toggles). Without the extension, pi says the command is unknown, which is fine.
      await this.type(panelId, "/guard off");
      if (await this.waitFor(panelId, /approvals are disabled/i, 5_000)) done.push("guard off");
    }
    return done;
  }
}
