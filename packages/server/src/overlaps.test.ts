import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAP_MS } from "./bridge/board.ts";
import { forgetPanel, receive } from "./bridge/index.ts";
import { panels, projects, settings } from "./db.ts";
import { models, refOf } from "./models.ts";
import { BATCH_MS, OverlapWakes, overlapList, startOverlaps } from "./overlaps.ts";
import { idle } from "./runs.ts";
import { createSprocket, listMessages, updateSettings } from "./sprockets.ts";

const look = { character: "cog", color: "green", accessory: "none" } as const;

describe("overlap wakes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gathers a burst of edits into one wake for the session that changed the files second", () => {
    const fire = vi.fn();
    const w = new OverlapWakes(fire);
    w.add("a", "b", "/x/1.ts");
    vi.advanceTimersByTime(BATCH_MS - 1);
    w.add("a", "b", "/x/2.ts");
    w.add("a", "c", "/x/1.ts");
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledWith("a", [
      { panelId: "b", files: ["/x/1.ts", "/x/2.ts"] },
      { panelId: "c", files: ["/x/1.ts"] },
    ]);
  });

  it("reports a pair of sessions once per file per window, whichever changed it last", () => {
    const fire = vi.fn();
    const w = new OverlapWakes(fire);
    w.add("a", "b", "/x/1.ts");
    vi.advanceTimersByTime(BATCH_MS);
    w.add("b", "a", "/x/1.ts"); // back and forth on the same file: already reported
    w.add("a", "b", "/x/1.ts");
    vi.advanceTimersByTime(BATCH_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    w.add("b", "a", "/x/2.ts"); // a new file is news
    vi.advanceTimersByTime(BATCH_MS);
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(OVERLAP_MS);
    w.add("a", "b", "/x/1.ts"); // and so is the same file, a window later
    vi.advanceTimersByTime(BATCH_MS);
    expect(fire).toHaveBeenCalledTimes(3);
  });

  it("forgets a closed panel", () => {
    const fire = vi.fn();
    const w = new OverlapWakes(fire);
    w.add("a", "b", "/x/1.ts");
    w.add("c", "b", "/x/1.ts");
    w.forget("b");
    vi.advanceTimersByTime(BATCH_MS);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("overlaps", () => {
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  beforeEach(() => settings.set("defaultModel", refOf(faux.getModel())));
  startOverlaps();

  const write = (path: string, file: string) => ({ session_id: "s", cwd: path, tool_name: "Edit", tool_input: { file_path: `${path}/${file}` } });
  const setup = (coordinator: boolean) => {
    const path = `/work/overlap-${Math.random()}`;
    const project = projects.create("app", path);
    const s = createSprocket({ name: "Lead", look });
    updateSettings(s.id, { projectId: project.id, coordinator });
    const a = panels.create({ projectId: project.id, kind: "claude", title: "Fix login", sessionId: `a-${Math.random()}` });
    const b = panels.create({ projectId: project.id, kind: "pi", title: "Refactor auth" });
    return { path, s, a, b };
  };
  const mine = (ids: string[]) => overlapList().filter((o) => ids.includes(o.panelId));

  it("marks both sessions and wakes the Coordinator for the second", async () => {
    const { path, s, a, b } = setup(true);
    let prompt = "";
    let system = "";
    faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.at(-1)?.content);
        system = JSON.stringify(context.messages.filter((m) => (m.role as string) === "system"));
        return fauxAssistantMessage("(quiet)");
      },
    ]);

    vi.useFakeTimers();
    receive(b.id, "pi", "tool", { cwd: path, tool: "edit", input: { path: "src/auth.ts" } });
    vi.advanceTimersByTime(60_000);
    expect(mine([a.id, b.id])).toEqual([]);
    receive(a.id, "claude", "PostToolUse", write(path, "src/auth.ts"));
    expect(mine([a.id, b.id])).toEqual([
      { panelId: b.id, otherPanelId: a.id, files: ["src/auth.ts"] },
      { panelId: a.id, otherPanelId: b.id, files: ["src/auth.ts"] },
    ]);
    vi.advanceTimersByTime(BATCH_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(listMessages(s.id).length).toBeGreaterThan(0));
    await idle();

    const [event] = listMessages(s.id);
    expect(event.event).toEqual({
      panelId: a.id,
      kind: "claude",
      title: "Fix login",
      sessionId: a.sessionId,
      what: "overlap",
      overlaps: [{ panelId: b.id, kind: "pi", title: "Refactor auth", files: ["src/auth.ts"] }],
      quiet: true,
    });
    expect(prompt).toContain("[Rails event, not from your user]");
    expect(prompt).toContain('\\"Fix login\\" (Claude Code, id');
    expect(prompt).toContain('with \\"Refactor auth\\" (pi, id');
    expect(prompt).toContain('\\"src/auth.ts\\"'); // quoted: a file name can't break out of the list
    expect(system).toContain("draft a short heads-up with suggest_message for the session that changed the files second");
  });

  it("clears the marks when a session ends, a panel closes or the window passes", () => {
    const { path, a, b } = setup(false);
    vi.useFakeTimers();
    const both = () => {
      receive(a.id, "claude", "PostToolUse", write(path, "src/x.ts"));
      receive(b.id, "pi", "tool", { cwd: path, tool: "write", input: { path: "src/x.ts" } });
      expect(mine([a.id, b.id])).toHaveLength(2);
    };
    both();
    vi.advanceTimersByTime(OVERLAP_MS + 2_000);
    expect(mine([a.id, b.id])).toEqual([]);
    both();
    receive(b.id, "pi", "session_shutdown", {});
    expect(mine([a.id, b.id])).toEqual([]);
    receive(b.id, "pi", "session_start", { sessionId: "p2" });
    both();
    panels.remove(b.id);
    forgetPanel(b.id);
    expect(mine([a.id, b.id])).toEqual([]);
    vi.useRealTimers();
  });

  it("wakes nobody in a project without a Coordinator", () => {
    const { path, s, a, b } = setup(false);
    vi.useFakeTimers();
    receive(a.id, "claude", "PostToolUse", write(path, "src/y.ts"));
    receive(b.id, "pi", "tool", { cwd: path, tool: "edit", input: { path: "src/y.ts" } });
    vi.advanceTimersByTime(BATCH_MS);
    vi.useRealTimers();
    expect(mine([a.id, b.id])).toHaveLength(2);
    expect(listMessages(s.id)).toEqual([]);
  });
});
