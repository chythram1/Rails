import { describe, expect, it } from "vitest";
import { findNames } from "./mentions.ts";

const team = ["Doc Keeper", "Pam", "Fred"];
const named = (t: string) => findNames(t, team).map((f) => [t.slice(f.start, f.end), team[f.member], f.at]);

describe("findNames", () => {
  it("finds members' names with an @ or without, as whole words, in any case", () => {
    expect(named("I don't do Pam's board or @fred's books.")).toEqual([["Pam", "Pam", false], ["@fred", "Fred", true]]);
    expect(named("doc keeper and @Doc agree")).toEqual([["doc keeper", "Doc Keeper", false], ["@Doc", "Doc Keeper", true]]);
    expect(named("Frederick, Pamela and spam@pam.com")).toEqual([]);
  });
});
