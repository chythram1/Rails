import { describe, expect, it } from "vitest";
import { href, parse } from "./router.ts";

describe("router", () => {
  it("opens new Customize items as drafts, apart from items' own ids", () => {
    expect(parse(href.newItem("skill"))).toEqual({ name: "customize", view: "new", tab: "skills", draft: "skill" });
    expect(parse(href.newItem("http"))).toEqual({ name: "customize", view: "new", tab: "connectors", draft: "http" });
    // A skill's id comes from its name, so a skill called "New" is a skill, not a draft.
    expect(parse(href.skill("new"))).toEqual({ name: "customize", view: "skill", tab: "skills", id: "new" });
    expect(parse("#/customize/new/nonsense")).toEqual({ name: "customize", view: "home", tab: "connectors" });
    expect(parse("#/customize/new/constructor")).toEqual({ name: "customize", view: "home", tab: "connectors" });
  });
});
