import { describe, expect, it } from "vitest";
import { listOf, stepText, summarize } from "./capabilities.ts";
import { memoryCapability } from "./memory.ts";
import { projectCapabilities } from "./project.ts";

const capabilities = [memoryCapability(() => {}), ...projectCapabilities];
const ok = (name: string, args: object = {}) => ({ name, args, status: "ok" });

describe("the run log", () => {
  it("sums up a run's calls in one line, merging repeats and counting what's distinct", () => {
    const calls = [
      ok("project_board"),
      ok("session_conversation", { session: "1a2b" }),
      ok("read_file", { path: "src/api.ts" }),
      ok("session_conversation", { session: "3c4d" }),
      ok("read_file", { path: "src/api.ts" }),
      ok("search_files", { query: "fetchUser" }),
    ];
    expect(summarize(capabilities, calls)).toBe("Looked at the board, read 2 conversations, read src/api.ts and searched for “fetchUser”");
  });

  it("counts failed steps and leaves out ones a script's end cut off", () => {
    const calls = [ok("git_status"), { name: "git_diff", args: {}, status: "error" }, { name: "read_file", args: { path: "a" }, status: "cancelled" }];
    expect(summarize(capabilities, calls)).toBe("Checked git status; 1 step failed");
    expect(summarize(capabilities, [])).toBeUndefined();
  });

  it("names the step a call is on", () => {
    const read = capabilities.find((c) => c.name === "read_file")!;
    expect(stepText(read, { path: "src/db.ts" })).toBe("Reading src/db.ts");
    expect(listOf(["a", "b", "c", "d", "a"], "files")).toBe("a, b and 2 more files");
  });
});
