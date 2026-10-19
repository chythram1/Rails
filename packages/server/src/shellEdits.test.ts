import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { shellCall } from "./bridge/events.ts";
import { cardOf, receive } from "./bridge/index.ts";
import { panels, projects } from "./db.ts";
import { changedFiles, porcelainPaths, snapshot, startShellEdits } from "./shellEdits.ts";

startShellEdits();

describe("shell commands' edits", () => {
  it("reads git's changed paths, renames included", () => {
    expect(porcelainPaths(" M a.txt\0?? b/c.txt\0R  new.txt\0old.txt\0 D gone.txt\0")).toEqual(["a.txt", "b/c.txt", "new.txt", "old.txt", "gone.txt"]);
  });

  it("finds files that changed between two snapshots, or after the start", () => {
    const before = new Map([["/p/a", "100:1"], ["/p/b", "100:1"], ["/p/c", "100:1"]]);
    const after = new Map([["/p/a", "100:1"], ["/p/b", "200:2"], ["/p/d", "150:1"], ["/p/e", "300:1"]]);
    // b changed, c is clean again, d and e are new; a didn't change.
    expect(changedFiles(before, after, 1_000).sort()).toEqual(["/p/b", "/p/c", "/p/d", "/p/e"]);
    // A start noted late: the file was already written, but after the command began.
    expect(changedFiles(new Map([["/p/a", "500:1"]]), new Map([["/p/a", "500:1"]]), 400)).toEqual(["/p/a"]);
  });

  it("hears shell commands from all three agents", () => {
    expect(shellCall("claude", "PreToolUse", { tool_name: "Bash", tool_use_id: "t1" })).toEqual({ phase: "start", id: "t1" });
    expect(shellCall("claude", "PostToolUse", { tool_name: "Bash", tool_use_id: "t1" })).toEqual({ phase: "end", id: "t1" });
    expect(shellCall("claude", "PostToolUse", { tool_name: "Edit", tool_use_id: "t2" })).toBeUndefined();
    expect(shellCall("pi", "tool", { tool: "bash", started: true, id: "p1" })).toEqual({ phase: "start", id: "p1" });
    expect(shellCall("pi", "tool_end", { id: "p1" })).toEqual({ phase: "end", id: "p1" });
    expect(shellCall("codex", "item/started", { item: { type: "commandExecution", id: "c1" } })).toEqual({ phase: "start", id: "c1" });
    expect(shellCall("codex", "item/completed", { item: { type: "fileChange", id: "c2" } })).toBeUndefined();
  });

  it("counts what a session's shell command wrote as its edits, but not what another session reported", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-shell-")));
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "old.txt"), "dirty before\n"); // already changed: not this command's
    const project = projects.create("app", root);
    const claude = panels.create({ projectId: project.id, kind: "claude", title: "Claude Code", sessionId: `c-${Math.random()}` });
    const pi = panels.create({ projectId: project.id, kind: "pi", title: "pi" });
    expect((await snapshot(root))?.has(join(root, "old.txt"))).toBe(true);
    await new Promise((r) => setTimeout(r, 1_100)); // past the start's slack, so old.txt counts as older

    receive(claude.id, "claude", "PreToolUse", { tool_name: "Bash", tool_use_id: "t1", cwd: root });
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(root, "engine.js"), "export {};\n"); // cat > engine.js
    writeFileSync(join(root, "ui.js"), "export {};\n"); // ...and pi edits ui.js with its own tool meanwhile
    receive(pi.id, "pi", "tool", { cwd: root, tool: "write", input: { path: "ui.js" } });
    receive(claude.id, "claude", "PostToolUse", { tool_name: "Bash", tool_use_id: "t1", cwd: root, tool_input: { command: "cat > engine.js" } });

    await vi.waitFor(() => expect(cardOf(claude).edits.map((e) => e.file)).toEqual([join(root, "engine.js")]));
  });

  it("ignores projects that aren't git repositories", async () => {
    expect(await snapshot(realpathSync(mkdtempSync(join(tmpdir(), "rails-nogit-"))))).toBeUndefined();
  });
});
