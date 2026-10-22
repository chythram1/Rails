import { beforeEach, describe, expect, it, vi } from "vitest";

// tmux and the agents' stores are faked: panels "run" once started, and a session lookup takes a while,
// like the first scan of a large pi store.
const running = new Set<string>();
vi.mock("./tmux.ts", () => ({
  startSession: vi.fn(async (id: string) => void running.add(id)),
  killSession: vi.fn(async (id: string) => void running.delete(id)),
  runningPanels: vi.fn(async () => new Set(running)),
}));
vi.mock("./providers/index.ts", () => ({
  discovery: { pi: { name: "pi" }, claude: { name: "Claude Code" }, codex: { name: "Codex" } },
  installed: () => true,
  findSession: vi.fn(async (provider: string, id: string) => {
    await new Promise((r) => setTimeout(r, 30));
    return { provider, id, cwd: "/work/app", title: "Old session", createdAt: "", updatedAt: "" };
  }),
}));

const { getWorkspace, openPanel, panelEnded } = await import("./panels.ts");
const { panels, projects } = await import("./db.ts");

describe("openPanel", () => {
  let projectId: string;
  beforeEach(() => {
    projectId = projects.create("app", `/work/app-${Math.random()}`).id;
  });

  it("opens a session once when two requests race (StrictMode, two devices)", async () => {
    const [a, b] = await Promise.all([
      openPanel(projectId, { kind: "pi", sessionId: "s-race" }),
      openPanel(projectId, { kind: "pi", sessionId: "s-race" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(panels.list(projectId).filter((p) => p.sessionId === "s-race")).toHaveLength(1);
  });

  it("returns the running panel when the session is opened again later", async () => {
    const first = await openPanel(projectId, { kind: "pi", sessionId: "s-again" });
    const again = await openPanel(projectId, { kind: "pi", sessionId: "s-again" });
    expect(again.id).toBe(first.id);
  });

  it("can open the session again after a failed attempt", async () => {
    const { startSession } = await import("./tmux.ts");
    vi.mocked(startSession).mockRejectedValueOnce(new Error("tmux failed"));
    await expect(openPanel(projectId, { kind: "pi", sessionId: "s-fail" })).rejects.toThrow("tmux failed");
    const panel = await openPanel(projectId, { kind: "pi", sessionId: "s-fail" });
    expect(panel.sessionId).toBe("s-fail");
  });

  it("keeps a panel that's still starting when the workspace is read meanwhile", async () => {
    // A session clicked on another page: the workspace loads its panels while the session's panel starts.
    const { startSession } = await import("./tmux.ts");
    let started = () => {};
    vi.mocked(startSession).mockImplementationOnce(async (id: string) => {
      await new Promise<void>((r) => (started = r));
      running.add(id);
    });
    const opening = openPanel(projectId, { kind: "pi", sessionId: "s-starting" });
    await new Promise((r) => setTimeout(r, 50)); // past the session lookup: the panel exists, its process doesn't yet
    const [starting] = panels.list(projectId);
    expect(starting.sessionId).toBe("s-starting");
    expect((await getWorkspace(projectId)).panels).toEqual([]); // not shown before it runs (nothing to attach to)
    await panelEnded(starting.id); // a browser's tmux client giving up early doesn't end it either
    started();
    const panel = await opening;
    expect(panels.get(panel.id)).toBeDefined();
    expect((await getWorkspace(projectId)).panels.map((p) => p.id)).toEqual([panel.id]);
  });

});
