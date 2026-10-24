import { describe, expect, it, vi } from "vitest";

// git itself is faked: each test says how `git status` fails.
const answer = vi.hoisted(() => ({ error: undefined as (Error & { stderr?: string; code?: string }) | undefined }));
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, out?: { stdout: string; stderr: string }) => void) =>
    answer.error ? cb(answer.error) : cb(null, { stdout: "## main\0", stderr: "" }),
}));

const { gitStatus } = await import("./git.ts");

const failure = (stderr: string, code?: string) => Object.assign(new Error("Command failed"), { stderr, code });

describe("gitStatus", () => {
  it("reads a folder without git, or one that's gone, as no repository", async () => {
    for (const stderr of ["fatal: not a git repository (or any of the parent directories): .git\n", "fatal: cannot change to '/gone': No such file or directory\n"]) {
      answer.error = failure(stderr);
      expect(await gitStatus("/work")).toMatchObject({ isRepo: false });
    }
  });

  it("says why when git fails for another reason, instead of calling it no repository", async () => {
    answer.error = failure("fatal: detected dubious ownership in repository at '/work'\nTo add an exception…\n");
    await expect(gitStatus("/work")).rejects.toThrow("git: detected dubious ownership in repository at '/work'");
    answer.error = failure("", "ENOENT");
    await expect(gitStatus("/work")).rejects.toThrow("git isn't installed");
  });
});
