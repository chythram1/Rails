import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { shellCall } from "../bridge/events.ts";
import { cardOf, receive } from "../bridge/index.ts";
import { panels, projects } from "../db.ts";
import { changedFiles, porcelainPaths, readsOnly, snapshot, startShellEdits } from "./shellEdits.ts";

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
    expect(shellCall("claude", "PreToolUse", { tool_name: "Bash", tool_use_id: "t3", tool_input: { command: "ls" } })).toEqual({ phase: "start", id: "t3", command: "ls" });
    expect(shellCall("codex", "item/started", { item: { type: "commandExecution", id: "c3", command: "/bin/zsh -lc 'ls'" } })?.command).toBe("/bin/zsh -lc 'ls'");
  });

  it("tells commands that only read", () => {
    for (const c of [
      "cat src/main.js src/engine/controls.js; cat src/ui/shop.js",
      "/bin/zsh -lc 'nl -ba src/ui/hud.js | head -30; nl -ba src/main.js | sed -n 65,95p'",
      "rg --files tests && git diff --stat",
      "node --test 2>&1 | tail -5",
      "cd src && ls -la >/dev/null",
      "FORCE_COLOR=0 git status --short",
    ])
      expect(readsOnly(c), c).toBe(true);
    for (const c of [
      undefined,
      "cat > engine.js",
      "echo hi >> notes.md",
      "sed -i '' 's/a/b/' x.js",
      "rg x && cat <<'EOF' > tests/a.test.js\nEOF",
      "node build.js",
      "npm test",
      "git checkout -- src/main.js",
      "find . -name '*.tmp' -delete",
      "python3 fix.py",
      "cat a | tee b",
    ])
      expect(readsOnly(c), String(c)).toBe(false);
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

    await vi.waitFor(() => expect(cardOf(claude).edits.map((e) => e.file)).toEqual([join(root, "engine.js")]), { timeout: 5_000 });
  });

  it("counts nothing for a command that only reads, and leaves a late edit report its own", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-shell-")));
    execFileSync("git", ["init", "-q"], { cwd: root });
    const project = projects.create("app", root);
    const codex = panels.create({ projectId: project.id, kind: "codex", title: "Codex" });
    const claude = panels.create({ projectId: project.id, kind: "claude", title: "Claude Code", sessionId: `c-${Math.random()}` });
    const pi = panels.create({ projectId: project.id, kind: "pi", title: "pi" });
    // Codex reads while Claude Code edits main.js with its tool.
    receive(codex.id, "codex", "item/started", { item: { type: "commandExecution", id: "r1", command: "/bin/zsh -lc 'cat src/main.js'" } });
    receive(pi.id, "pi", "tool", { cwd: root, tool: "bash", started: true, id: "w1", input: { command: "python3 gen.py" } });
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(root, "main.js"), "export {};\n");
    receive(codex.id, "codex", "item/completed", { item: { type: "commandExecution", id: "r1", command: "/bin/zsh -lc 'cat src/main.js'" } });
    receive(pi.id, "pi", "tool_end", { id: "w1" });
    // Claude Code's report of its edit comes in after both commands ended.
    await new Promise((r) => setTimeout(r, 300));
    receive(claude.id, "claude", "PostToolUse", { tool_name: "Edit", tool_use_id: "e1", cwd: root, tool_input: { file_path: join(root, "main.js") } });
    await new Promise((r) => setTimeout(r, 2_500));
    expect(cardOf(codex).edits).toEqual([]);
    expect(cardOf(pi).edits).toEqual([]);
    expect(cardOf(claude).edits.map((e) => e.file)).toEqual([join(root, "main.js")]);
  });

  it("ignores projects that aren't git repositories", async () => {
    expect(await snapshot(realpathSync(mkdtempSync(join(tmpdir(), "rails-nogit-"))))).toBeUndefined();
  });
});
