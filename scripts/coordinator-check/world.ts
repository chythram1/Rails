// A scene for one check: a git project, sessions with transcripts and bridge events, and the project's
// Coordinator with run 2's description, rules and owners. Imported only after cli.ts has pointed RAILS_HOME and
// the provider homes at throwaway folders.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Panel, Project, SessionQuestion, Sprocket, SprocketEvent } from "@rails/shared";
import { receive, record } from "../../packages/server/src/bridge/index.ts";
import { fromCodex } from "../../packages/server/src/bridge/events.ts";
import { panels, projects, sprocketMessages, suggestions, usage } from "../../packages/server/src/db.ts";
import { planHandoff } from "../../packages/server/src/handoffs.ts";
import { setOwner } from "../../packages/server/src/owners.ts";
import { createSprocket, listMessages, postEvent, projectChat, sendMessage, updateSettings } from "../../packages/server/src/sprockets.ts";
import { sessionTitle } from "../../packages/server/src/titles.ts";

type Kind = "claude" | "pi" | "codex";

/** One exchange in a session: what the user asked, the files the agent changed, what it replied ("": still going). */
export interface Turn {
  user: string;
  edits?: string[];
  reply: string;
}

/** Run 2's Coordinator, as the user set it up (`.test-runs/gearworks-2.json`). */
const DESCRIPTION =
  "You coordinate three coding agents building a browser tower-defense game (BRIEF.md): Claude Code owns the engine and wiring, Codex owns gameplay (src/game), pi owns the UI and audio (src/ui). Keep module ownership clean, keep answers short, and tell me plainly when something needs my decision.";
export const RULES = [
  "If a session asks whether to go ahead with its plan or the next step, say yes.",
  "If it asks me to choose between approaches, pick the simpler one that keeps plain JavaScript modules with no build step.",
  "If it asks about game numbers or balance, pick a sensible value and say we'll tune it after playtesting.",
  "Never agree to add dependencies, frameworks, build tools, or image or audio files.",
  "If it asks whether to commit, say no: I commit at milestones.",
  "If it asks whether to run node --check or node --test, say yes.",
  "If it asks to change a file another session owns (see BRIEF.md), tell it to leave that file and say what it needs instead.",
];
const BRIEF = readFileSync(join(import.meta.dirname, "..", "test-run", "briefs", "gearworks.md"), "utf8");
const LOOK = { character: "cog", color: "pink", accessory: "none" } as const;

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
function put(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export class World {
  readonly project: Project;
  readonly dir: string;
  readonly coordinator: Sprocket;
  private clock = Date.now() - 40 * 60_000;

  constructor(name: string, files: Record<string, string>, model: string) {
    const dir = join(process.env.CHECK_PROJECTS!, name);
    mkdirSync(dir, { recursive: true });
    this.dir = realpathSync(dir); // agents record the real cwd
    for (const [rel, text] of Object.entries({ "BRIEF.md": BRIEF, ...files })) put(join(this.dir, rel), text);
    this.git("init", "-q");
    this.commit("Start from the brief");
    this.project = projects.create(name, this.dir);
    this.coordinator = createSprocket({ name: "Foreman", look: LOOK });
    updateSettings(this.coordinator.id, { projectId: this.project.id, model, description: DESCRIPTION, rules: RULES });
  }

  /** A time a little after the last one, so transcripts and chat read in order. */
  private tick(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }

  git(...args: string[]): string {
    return execFileSync("git", ["-c", "user.name=Check", "-c", "user.email=check@example.com", ...args], { cwd: this.dir, encoding: "utf8" });
  }

  write(files: Record<string, string>): void {
    for (const [rel, text] of Object.entries(files)) put(join(this.dir, rel), text);
  }

  commit(message: string): void {
    this.git("add", "-A");
    this.git("commit", "-q", "-m", message);
  }

  /**
   * An agent session in a panel: its transcript where its agent keeps it, and the bridge events Rails would
   * have heard (the prompt, the edits that worked, the turn's end). Claude Code gets its own title; pi and Codex
   * are titled by their first prompt, as they are.
   */
  session(kind: Kind, turns: Turn[], claudeTitle?: string): Panel {
    const sessionId = randomUUID();
    const panel = panels.create({ projectId: this.project.id, kind, title: kind, sessionId });
    const cwd = this.dir;
    const lines: object[] = [];
    if (kind === "pi") lines.push({ type: "session", version: 3, id: sessionId, timestamp: this.tick(), cwd });
    if (kind === "codex") lines.push({ type: "session_meta", payload: { id: sessionId, cwd, timestamp: this.tick() } });
    for (const t of turns) {
      const at = this.tick();
      if (kind === "claude") {
        lines.push({ type: "user", cwd, sessionId, timestamp: at, message: { role: "user", content: t.user } });
        if (t.reply) lines.push({ type: "assistant", timestamp: at, message: { id: randomUUID(), role: "assistant", content: [{ type: "text", text: t.reply }] } });
        receive(panel.id, "claude", "UserPromptSubmit", { prompt: t.user, cwd });
        for (const f of t.edits ?? []) receive(panel.id, "claude", "PostToolUse", { tool_name: "Edit", tool_input: { file_path: join(cwd, f) }, cwd });
        if (t.reply) receive(panel.id, "claude", "Stop", { last_assistant_message: t.reply });
      } else if (kind === "pi") {
        lines.push({ type: "message", timestamp: at, message: { role: "user", content: [{ type: "text", text: t.user }] } });
        if (t.reply) lines.push({ type: "message", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: t.reply }] } });
        receive(panel.id, "pi", "prompt", { text: t.user, cwd });
        for (const f of t.edits ?? []) receive(panel.id, "pi", "tool", { tool: "edit", input: { path: f }, cwd });
        if (t.reply) receive(panel.id, "pi", "agent_end", { text: t.reply });
      } else {
        lines.push({ type: "response_item", timestamp: at, payload: { type: "message", role: "user", content: [{ type: "input_text", text: t.user }] } });
        if (t.reply) lines.push({ type: "response_item", timestamp: at, payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: t.reply }] } });
        record(panel.id, fromCodex("item/completed", { item: { type: "userMessage", content: [{ type: "text", text: t.user }] } }));
        if (t.edits?.length) record(panel.id, fromCodex("item/completed", { item: { type: "fileChange", status: "completed", changes: t.edits.map((f) => ({ path: join(cwd, f) })) } }));
        if (t.reply) record(panel.id, fromCodex("turn/completed", { turn: { status: "completed", items: [{ type: "agentMessage", text: t.reply }] } }));
      }
    }
    if (kind === "claude") {
      if (claudeTitle) lines.push({ type: "ai-title", aiTitle: claudeTitle, sessionId });
      put(join(process.env.CLAUDE_HOME!, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`), jsonl(lines));
    } else if (kind === "pi") {
      put(join(process.env.PI_HOME!, "sessions", `--${cwd.slice(1).replace(/\//g, "-")}--`, `${new Date(this.clock).toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`), jsonl(lines));
    } else {
      const d = new Date(this.clock);
      const day = [String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, "0"), String(d.getUTCDate()).padStart(2, "0")];
      put(join(process.env.CODEX_HOME!, "sessions", ...day, `rollout-${d.toISOString().slice(0, 19).replace(/:/g, "-")}-${sessionId}.jsonl`), jsonl(lines));
    }
    return panel;
  }

  /** The session is waiting on a question in a dialog (pi's question tool). */
  ask(panel: Panel, questions: SessionQuestion[]): void {
    receive(panel.id, "pi", "ui_prompt_start", { input: { questions } });
  }

  owner(panel: Panel, paths: string[]): void {
    setOwner(this.project, panel, paths);
  }

  handoff(from: Panel, to: Panel, note: string): string {
    return planHandoff(this.coordinator.id, { panel: from, title: from.title }, { panel: to, title: to.title }, note).id;
  }

  /** Earlier chat in the project chat (ADR 0021): the user's message and the Coordinator's reply, without running it. */
  history(user: string, reply: string): void {
    sprocketMessages.create(projectChat(this.coordinator.id), "user", user, this.tick());
    sprocketMessages.create(projectChat(this.coordinator.id), "sprocket", reply, this.tick());
  }

  /** The user writes to the Coordinator in the project chat, which replies. */
  say(text: string): void {
    sendMessage(projectChat(this.coordinator.id), text);
  }

  /** Rails wakes the Coordinator, as watches.ts, overlaps.ts and handoffs do. */
  async wake(panel: Panel, event: Omit<SprocketEvent, "panelId" | "kind" | "title" | "sessionId">, text: string): Promise<void> {
    postEvent(this.coordinator.id, { panelId: panel.id, kind: panel.kind, title: await sessionTitle(panel), sessionId: panel.sessionId, ...event }, text);
  }

  async title(panel: Panel): Promise<string> {
    return sessionTitle(panel);
  }

  /** What the Coordinator did: its replies since the scene was set, whether it stayed quiet, and its drafts. */
  outcome(): Outcome {
    const messages = listMessages(projectChat(this.coordinator.id));
    const lastUser = messages.findLastIndex((m) => m.author === "user" || m.author === "event");
    const after = messages.slice(lastUser + 1);
    const drafts = [...suggestions.byMessage(this.coordinator.id).values()].flat().map((s) => ({
      to: s.panelId,
      title: s.title,
      mode: s.mode,
      rule: s.rule ? RULES.indexOf(s.rule) + 1 : undefined,
      text: s.text,
      attachment: !!s.attachment,
    }));
    const replies = after.filter((m) => m.author === "sprocket");
    const steps = sprocketMessages.recentSteps(projectChat(this.coordinator.id), this.coordinator.id, 3);
    return {
      reply: replies.map((m) => m.text).join("\n\n"),
      activity: replies.map((m) => m.activity ?? "").filter(Boolean).join("; "),
      steps: replies.flatMap((m) => steps.get(m.id) ?? []),
      usage: usage.total(this.coordinator.id),
      notices: after.filter((m) => m.author === "notice").map((m) => m.text),
      quiet: !!messages[lastUser]?.event?.quiet,
      drafts,
    };
  }
}

export interface Draft {
  /** The panel it's for, and its title. */
  to: string;
  title: string;
  mode: "reply" | "answer" | "message";
  /** The rule's number, if it cited one. */
  rule?: number;
  text: string;
  attachment: boolean;
}

export interface Outcome {
  reply: string;
  /** What its tools did, as the chat shows it, and its tool calls and results. */
  activity: string;
  steps: unknown[];
  usage: { runs: number; tokens: number; cost: number };
  notices: string[];
  quiet: boolean;
  drafts: Draft[];
}
