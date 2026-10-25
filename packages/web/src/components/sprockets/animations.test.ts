import { describe, expect, it } from "vitest";
import { doneFor } from "./animations.ts";

const reply = (id: string, more = {}) => ({ id, author: "sprocket" as const, text: "Here you go.", ...more });

describe("the animation once a reply is done", () => {
  it("goes by how it ended", () => {
    expect(doneFor({ id: "a", author: "notice", text: "Something went wrong: timeout" })).toBe("droop");
    expect(doneFor({ id: "b", author: "notice", text: "The model returned an error: 500" })).toBe("droop");
    expect(doneFor({ id: "c", author: "notice", text: "Stopped after 40 steps." })).toBe("puzzled");
    expect(doneFor({ id: "d", author: "notice", text: "Paused: more than 60 replies in the last hour." })).toBe("puzzled");
    expect(doneFor(reply("e", { ask: { question: "Which?", options: ["A", "B"] } }))).toBe("notify");
    expect(doneFor(reply("f", { card: { blocks: [], actions: [{ label: "Run" }] } } as never))).toBe("notify");
  });

  it("an answered question or a card with nothing to run is just a reply", () => {
    expect(doneFor(reply("g", { ask: { question: "Which?", options: [], answer: "A" } }))).not.toBe("notify");
    expect(doneFor(reply("h", { card: { blocks: [{ kind: "text", text: "Hi" }] } } as never))).not.toBe("notify");
  });

  it("a reply celebrates, the same way each time for the same message, mostly not a twirl", () => {
    const picks = Array.from({ length: 300 }, (_, i) => doneFor(reply(`m${i}`)));
    expect(new Set(picks)).toEqual(new Set(["cheer", "satisfied", "hooray", "twirl"]));
    expect(picks.filter((p) => p === "twirl").length).toBeLessThan(60);
    expect(doneFor(reply("m7"))).toBe(picks[7]);
  });
});
