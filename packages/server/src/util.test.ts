import { describe, expect, it, vi } from "vitest";
import { listeners } from "./util.ts";

describe("listeners", () => {
  it("tells every listener, even after one throws, and never throws at the caller", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const changes = listeners<[n: number]>();
    const heard: number[] = [];
    changes.on(() => {
      throw new Error("broken listener");
    });
    changes.on((n) => heard.push(n));
    expect(() => changes.emit(1)).not.toThrow();
    expect(heard).toEqual([1]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
