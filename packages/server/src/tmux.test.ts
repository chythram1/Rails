import { describe, expect, it, vi } from "vitest";

// tmux itself is faked: each test says what `tmux list-windows` answers.
const answer = vi.hoisted(() => ({ stdout: "", error: undefined as (Error & { stderr?: string; code?: string }) | undefined }));
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown, out?: { stdout: string; stderr: string }) => void) =>
    answer.error ? cb(answer.error) : cb(null, { stdout: answer.stdout, stderr: "" }),
}));

const { killSession, panelActivity } = await import("./tmux.ts");

const failure = (stderr: string, code?: string) => Object.assign(new Error("Command failed"), { stderr, code });

describe("panelActivity", () => {
  it("lists the panels' sessions with their last output", async () => {
    answer.error = undefined;
    answer.stdout = "p-a 100\np-b 200\nother 300\n";
    expect([...(await panelActivity())]).toEqual([
      ["a", 100],
      ["b", 200],
    ]);
  });

  it("reads no tmux server as no panels", async () => {
    for (const stderr of [
      "no server running on /home/x/.rails/tmux.sock\n",
      "error connecting to /home/x/.rails/tmux.sock (No such file or directory)\n",
      "error connecting to /home/x/.rails/tmux.sock (Connection refused)\n",
    ]) {
      answer.error = failure(stderr);
      expect((await panelActivity()).size).toBe(0);
    }
  });

  it("fails on any other error, so no panel is taken for ended", async () => {
    answer.error = failure("", "EAGAIN");
    await expect(panelActivity()).rejects.toThrow();
    answer.error = failure("error connecting to /home/x/.rails/tmux.sock (Permission denied)\n");
    await expect(panelActivity()).rejects.toThrow();
    answer.error = failure("", "ENOENT"); // tmux isn't installed
    await expect(panelActivity()).rejects.toThrow(/tmux/i);
  });
});

describe("killSession", () => {
  it("is fine when the session or the server is already gone", async () => {
    for (const stderr of ["can't find session: p-a\n", "no server running on /home/x/.rails/tmux.sock\n"]) {
      answer.error = failure(stderr);
      await expect(killSession("a")).resolves.toBeUndefined();
    }
  });

  it("fails otherwise, so a panel isn't dropped while its process runs", async () => {
    answer.error = failure("", "EAGAIN");
    await expect(killSession("a")).rejects.toThrow();
  });
});
