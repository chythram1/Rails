// Cards (ADR 0024): show_card posts a card in direct and team chats, checked, with its plain text beside it.
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type TranscriptContext } from "@earendil-works/pi-ai";
import { cardText, type SprocketCard } from "@rails/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { projects, settings } from "./db.ts";
import { models, refOf } from "./models.ts";
import { idle } from "./runs.ts";
import { createSprocket, directChat, listMessages, projectChat, sendMessage, updateSettings } from "./sprockets.ts";

const faux = fauxProvider();
models.setProvider(faux.provider);
const ref = refOf(faux.getModel());
const look = { character: "bean", color: "teal", accessory: "none" } as const;
beforeEach(() => settings.set("defaultModel", ref));

const script = (code: string) => fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" });
const show = (card: unknown) => `text(await tools.show_card(${JSON.stringify(card)}))`;
/** The last tool result a scripted model call was given. */
const lastResult = (c: TranscriptContext) => {
  const r = c.messages.filter((m) => m.role === "toolResult").at(-1);
  return r && r.role === "toolResult" ? (r.content[0] as { text: string }).text : "";
};

const card: SprocketCard = {
  title: "Plans",
  blocks: [
    { type: "table", columns: ["Plan", "Price"], rows: [["Free", "$0"], ["Pro | team", "$8"]] },
    { type: "checklist", items: [{ text: "Sign up", state: "done" }, { text: "Pay", state: "doing" }, { text: "Ship", state: "todo" }] },
  ],
};

describe("cards", () => {
  it("reads as plain text: a Markdown table, a checklist, facts, code", () => {
    expect(cardText(card)).toBe("Plans\n\n| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| Pro \\| team | $8 |\n\n[x] Sign up\n[~] Pay\n[ ] Ship");
    expect(cardText({ blocks: [{ type: "facts", items: [{ label: "Size", value: "2 MB" }] }, { type: "code", code: "x()", language: "js" }] })).toBe(
      "Size: 2 MB\n\n```js\nx()\n```",
    );
  });

  it("posts a card right away in a direct chat, and the turn goes on; the model sees it as Rails' note", async () => {
    const s = createSprocket({ name: "Helper", look });
    // The script doesn't print what show_card returned: the model is told anyway (an echo capability).
    let told = "";
    faux.setResponses([script(`await tools.show_card(${JSON.stringify(card)})`), (c) => ((told = lastResult(c)), fauxAssistantMessage("Pro is the one."))]);
    sendMessage(directChat(s.id), "compare plans");
    await idle();
    expect(told).toContain("show_card: Shown: your user sees the card now.");
    const [, shown, reply] = listMessages(directChat(s.id));
    expect(shown).toMatchObject({ author: "sprocket", card, text: cardText(card) });
    expect(reply.text).toBe("Pro is the one.");

    let seen = "";
    faux.setResponses([(c) => ((seen = JSON.stringify(c.messages)), fauxAssistantMessage("Sure."))]);
    sendMessage(directChat(s.id), "thanks");
    await idle();
    expect(seen).toContain("[Rails] You showed a card (show_card)");
  });

  it("refuses a table row that doesn't fit its columns, and a fourth card in a turn", async () => {
    const s = createSprocket({ name: "Helper", look });
    const results: string[] = [];
    const bad = { blocks: [{ type: "table", columns: ["A", "B"], rows: [["1"]] }] };
    const small = { blocks: [{ type: "list", items: ["x"] }] };
    faux.setResponses([
      script(show(bad)),
      (c) => (results.push(lastResult(c)), script([1, 2, 3, 4].map(() => show(small)).join(";"))),
      (c) => (results.push(lastResult(c)), fauxAssistantMessage("Done.")),
    ]);
    sendMessage(directChat(s.id), "go");
    await idle();
    let offered = "";
    faux.setResponses([(c) => ((offered = JSON.stringify(c.messages[0])), fauxAssistantMessage("Ok."))]);
    sendMessage(directChat(s.id), "again");
    await idle();
    expect(offered).toContain("show_card");
    expect(results[0]).toMatch(/row 1 has 1 cells, but the table has 2 columns/);
    expect(results[1]).toMatch(/You've shown 3 cards this turn/);
    expect(listMessages(directChat(s.id)).filter((m) => m.card)).toHaveLength(3);
  });

  it("isn't offered in a project chat", async () => {
    const project = projects.create("cards", "/work/cards-project");
    const s = createSprocket({ name: "Lead", look });
    updateSettings(s.id, { projectId: project.id });
    let tools = "";
    faux.setResponses([(c) => ((tools = JSON.stringify(c.messages[0])), fauxAssistantMessage("Hi."))]);
    sendMessage(projectChat(s.id), "hello");
    await idle();
    expect(tools).not.toContain("show_card");
    expect(tools).toContain("project_board");
  });
});
