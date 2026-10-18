import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectFile, searchProject } from "./files.ts";
import { gitShow } from "./git.ts";
import { projectCapabilities } from "./harness/project.ts";

// A throwaway repository: code, a secret, an ignored build folder, a binary and a link out of the project.
const root = realpathSync(mkdtempSync(join(tmpdir(), "rails-files-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "rails-outside-")));
writeFileSync(join(outside, "private.txt"), "not yours");
mkdirSync(join(root, "src"));
mkdirSync(join(root, "dist"));
writeFileSync(join(root, "src", "api.ts"), Array.from({ length: 30 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join("\n") + "\n");
writeFileSync(join(root, ".env"), "SECRET_TOKEN=abc123\n");
writeFileSync(join(root, ".env.example"), "SECRET_TOKEN=\n");
writeFileSync(join(root, ".gitignore"), "dist/\n.env\n");
writeFileSync(join(root, "dist", "bundle.js"), "export const line1 = 'built';\n");
writeFileSync(join(root, "logo.bin"), Buffer.from([1, 0, 2, 3]));
symlinkSync(join(outside, "private.txt"), join(root, "escape.txt"));
const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
git("init", "-q");
git("add", ".");
git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
const project = { id: "p", name: "app", path: root, createdAt: "" };
/** A project capability, run as an attached Sprocket would. */
const capability = (name: string) => (args: object) =>
  projectCapabilities.find((c) => c.name === name)!.run(args, { sprocketId: "s", project, signal: new AbortController().signal });

describe("project files, for Sprockets", () => {
  it("reads a window of a file and says how to read on", async () => {
    const text = await readProjectFile(root, "src/api.ts", { from: 5, lines: 3 });
    expect(text).toContain("export const line5 = 5;\nexport const line6 = 6;\nexport const line7 = 7;");
    expect(text).toContain("[Lines 5–7 of 31 in src/api.ts. Read on with { from: 8 }.]");
    expect(await readProjectFile(root, "./src/api.ts")).toContain("line30");
  });

  it("lists a folder, without secrets or ignored files", async () => {
    const list = await readProjectFile(root, ".");
    expect(list).toContain("src/");
    expect(list).toContain(".env.example");
    expect(list).not.toMatch(/^\.env$/m);
    expect(list).not.toContain("dist/");
  });

  it("refuses paths outside the project, links out of it, secrets, ignored and binary files", async () => {
    await expect(readProjectFile(root, "../x")).rejects.toThrow();
    await expect(readProjectFile(root, join(outside, "private.txt"))).rejects.toThrow("outside the project");
    await expect(readProjectFile(root, "escape.txt")).rejects.toThrow("outside the project");
    await expect(readProjectFile(root, ".env")).rejects.toThrow("may hold secrets");
    await expect(readProjectFile(root, ".git/config")).rejects.toThrow("may hold secrets");
    await expect(readProjectFile(root, "dist/bundle.js")).rejects.toThrow("ignored by git");
    await expect(readProjectFile(root, "logo.bin")).rejects.toThrow("binary");
  });

  it("searches without ignored files or secrets", async () => {
    const { matches, truncated } = await searchProject(root, "line1", { limit: 5 });
    expect(matches.length).toBe(5);
    expect(truncated).toBe(true);
    expect(matches.every((m) => m.path === "src/api.ts")).toBe(true);
    expect((await searchProject(root, "SECRET_TOKEN")).matches.map((m) => m.path)).toEqual([".env.example"]);
    expect((await searchProject(root, "line2\\d", { regex: true })).matches.map((m) => m.line)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("keeps every kind of secret out of diffs and commits, and refuses options posing as commits", async () => {
    // Tracked secrets of each kind the policy covers, changed after the commit that added them.
    const secrets = [".env", ".ssh/config", ".aws/credentials", "deploy/id_ecdsa", "certs/server.pem", ".pypirc", ".git-credentials"];
    for (const f of secrets) {
      mkdirSync(join(root, f, ".."), { recursive: true });
      writeFileSync(join(root, f), "TOKEN=first\n");
    }
    git("add", "-f", ...secrets);
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "add secrets");
    for (const f of secrets) writeFileSync(join(root, f), "TOKEN=leaked\n");
    writeFileSync(join(root, "src", "api.ts"), "changed\n");
    const diff = (await capability("git_diff")({})) as string;
    expect(diff).toContain("+changed");
    expect(diff).not.toMatch(/TOKEN=/);
    for (const f of secrets) expect(diff).toContain(`[Changes to ${f} left out: it may hold secrets.]`);
    const commit = (await capability("git_show")({ commit: "HEAD" })) as string;
    expect(commit).toContain("add secrets");
    expect(commit).not.toMatch(/TOKEN=/);
    await expect(capability("git_diff")({ path: ".aws/credentials" })).rejects.toThrow("may hold secrets");
    await expect(gitShow(root, "--output=/tmp/x", 1024)).rejects.toThrow("isn't a commit name");
  });

  it("stops reading a huge commit early, and lists a huge folder within bounds", async () => {
    writeFileSync(join(root, "big.txt"), "x".repeat(80) + "\n".repeat(1) + Array.from({ length: 40_000 }, (_, i) => `line ${i}`).join("\n"));
    git("add", "big.txt");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "big");
    const raw = await gitShow(root, "HEAD", 64 * 1024);
    expect(raw.cut).toBe(true);
    expect(raw.text.length).toBeLessThanOrEqual(64 * 1024);
    expect((await capability("git_show")({ commit: "HEAD" })) as string).toContain("was cut");
    mkdirSync(join(root, "many"));
    for (let i = 0; i < 3000; i++) writeFileSync(join(root, "many", `f${i}.txt`), "");
    const list = await readProjectFile(root, "many");
    expect(list).toContain("(the first 300 of many entries)");
    expect(list.split("\n").length).toBe(301);
  });
});
