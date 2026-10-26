import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { receive } from "../bridge/index.ts";
import { panels, projects } from "../db.ts";
import { projectChanges } from "./changes.ts";
import { parseNumstat } from "./git.ts";

describe("the Git tab's changes", () => {
  it("reads git's line counts, renames and binary files included", () => {
    const counts = parseNumstat("3\t1\tsrc/a.ts\0" + "-\t-\tlogo.png\0" + "2\t0\t\0old.ts\0new.ts\0" + "-\t-\t\0a.bin\0b.bin\0" + "0\t4\tgone.ts\0");
    expect(Object.fromEntries(counts)).toEqual({ "src/a.ts": { added: 3, deleted: 1 }, "new.ts": { added: 2, deleted: 0 }, "gone.ts": { added: 0, deleted: 4 } });
  });

  it("names the open sessions that changed each file, newest first, and counts its lines", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-changes-")));
    const sh = (...args: string[]) => execFileSync("git", args, { cwd: root });
    sh("init", "-q");
    writeFileSync(join(root, "engine.js"), "a\nb\n");
    writeFileSync(join(root, "notes.md"), "x\n");
    sh("add", ".");
    sh("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start");
    writeFileSync(join(root, "engine.js"), "a\nc\nd\n"); // 2 added, 1 deleted
    writeFileSync(join(root, "notes.md"), "y\n"); // nobody reported this one
    mkdirSync(join(root, "ui"));
    writeFileSync(join(root, "ui", "hud.js"), "export {};\n"); // a new folder: git lists "ui/"

    const project = projects.create("app", root);
    const claude = panels.create({ projectId: project.id, kind: "claude", title: "Claude Code", sessionId: `c-${Math.random()}` });
    const pi = panels.create({ projectId: project.id, kind: "pi", title: "pi" });
    receive(claude.id, "claude", "PostToolUse", { tool_name: "Edit", tool_use_id: "e1", cwd: root, tool_input: { file_path: join(root, "engine.js") } });
    await new Promise((r) => setTimeout(r, 10)); // so pi's edit is the later one
    receive(pi.id, "pi", "tool", { cwd: root, tool: "write", input: { path: "engine.js" } });
    receive(pi.id, "pi", "tool", { cwd: root, tool: "write", input: { path: "ui/hud.js" } });

    const { files } = await projectChanges(project.id);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(byPath["engine.js"]).toMatchObject({ added: 2, deleted: 1 });
    expect(byPath["engine.js"].editedBy?.map((e) => e.kind)).toEqual(["pi", "claude"]);
    expect(byPath["notes.md"].editedBy).toEqual([]);
    expect(byPath["ui/"].editedBy?.map((e) => e.panelId)).toEqual([pi.id]);
    expect(byPath["ui/"].added).toBeUndefined(); // untracked: no counts
  });
});
