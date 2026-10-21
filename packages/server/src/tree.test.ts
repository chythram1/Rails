import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFolder, previewFile } from "./tree.ts";

// A throwaway repository: committed code, one file changed, one added, one untracked in a new folder, one deleted,
// a secret, an ignored build folder, a binary and a link out of the project.
const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-tree-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "rails-tree-out-")));
writeFileSync(join(outside, "private.txt"), "not yours");
const write = (rel: string, text: string | Buffer) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
write("src/engine/loop.js", "export const loop = 1;\n");
write("src/engine/input.js", "export const input = 1;\n");
write("src/ui/hud.js", "export const hud = 1;\n");
write("old.js", "gone soon\n");
write("README.md", "# App\n");
write(".gitignore", "dist/\n.env\n");
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
git("init", "-q");
git("add", ".");
git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
write("src/engine/loop.js", "export const loop = 2;\n"); // modified
write("src/engine/speed.js", "export const speed = 3;\n");
git("add", "src/engine/speed.js"); // added
write("src/game/waves.js", "export const waves = [];\n"); // untracked, in a new folder
rmSync(join(root, "old.js")); // deleted
write(".env", "SECRET_TOKEN=abc123\n");
write("dist/bundle.js", "built\n");
write("logo.bin", Buffer.from([1, 0, 2, 3]));
symlinkSync(join(outside, "private.txt"), join(root, "escape.txt"));

const names = (entries: { name: string }[]) => entries.map((e) => e.name);

describe("the file tree", () => {
  it("lists a folder, folders first, without .git, with each file's git state", async () => {
    const top = await listFolder(root, "");
    expect(top.isRepo).toBe(true);
    expect(names(top.entries)).toEqual(["dist", "src", ".env", ".gitignore", "escape.txt", "logo.bin", "README.md"]);
    const engine = await listFolder(root, "src/engine");
    expect(engine.entries.map((e) => [e.name, e.git ?? null])).toEqual([
      ["input.js", null],
      ["loop.js", "modified"],
      ["speed.js", "added"],
    ]);
    expect((await listFolder(root, "src/game")).entries).toMatchObject([{ name: "waves.js", git: "untracked" }]);
  });

  it("marks folders holding changes with the strongest of them, and what git ignores", async () => {
    const src = await listFolder(root, "src");
    expect(src.entries.map((e) => [e.name, e.git ?? null])).toEqual([
      ["engine", "modified"],
      ["game", "untracked"],
      ["ui", null],
    ]);
    const top = await listFolder(root, "");
    expect(top.entries.find((e) => e.name === "dist")).toMatchObject({ dir: true, ignored: true });
    expect(top.entries.find((e) => e.name === ".env")).toMatchObject({ ignored: true });
    expect(top.entries.find((e) => e.name === "README.md")!.ignored).toBeUndefined();
    expect(top.deleted).toEqual(["old.js"]); // gone from disk: listed apart, for the Git tab
  });

  it("works outside a repository too", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "rails-tree-plain-")));
    writeFileSync(join(plain, "notes.txt"), "hi");
    const r = await listFolder(plain, "");
    expect(r).toMatchObject({ isRepo: false, entries: [{ name: "notes.txt", dir: false }] });
    expect(r.entries[0].git).toBeUndefined();
  });

  it("shows a file's text, but not secrets, binaries, links out of the project or folders", async () => {
    expect(await previewFile(root, "src/engine/loop.js")).toEqual({ text: "export const loop = 2;\n", cut: false });
    await expect(previewFile(root, ".env")).rejects.toThrow(/may hold secrets/);
    await expect(previewFile(root, "logo.bin")).rejects.toThrow(/binary/);
    await expect(previewFile(root, "escape.txt")).rejects.toThrow(/outside the project/);
    await expect(previewFile(root, "../x")).rejects.toThrow();
    await expect(previewFile(root, "src")).rejects.toThrow(/folder/);
    await expect(listFolder(root, "../")).rejects.toThrow(/outside the project/);
  });

  it("cuts a long file short and says so", async () => {
    write("big.txt", "x".repeat(300_000));
    const r = await previewFile(root, "big.txt");
    expect(r.cut).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(256 * 1024);
  });
});
