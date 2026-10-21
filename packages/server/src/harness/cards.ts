// Cards (ADR 0024): a Sprocket shows a table, facts, a list, a checklist, code or a diff, drawn by Rails from its own
// components, instead of writing it out as text. Offered where send_message is (direct and team chats).
import { Type } from "@earendil-works/pi-ai";
import { CARD_LIMITS as L, type CardBlock, type SprocketCard } from "@rails/shared";
import type { Capability } from "./capabilities.ts";

/** Cards one run may show. */
export const CARDS_MAX = 3;

const str = (max: number, description?: string) => Type.String({ minLength: 1, maxLength: max, ...(description ? { description } : {}) });

const block = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: str(L.text, "A short paragraph in the card.") }),
  Type.Object({
    type: Type.Literal("table"),
    columns: Type.Array(str(L.cell), { minItems: 1, maxItems: L.columns }),
    rows: Type.Array(Type.Array(Type.String({ maxLength: L.cell })), { minItems: 1, maxItems: L.rows, description: "Each row has a cell per column." }),
  }),
  Type.Object({
    type: Type.Literal("facts"),
    items: Type.Array(Type.Object({ label: str(60), value: str(L.item) }), { minItems: 1, maxItems: L.items, description: "Label and value pairs." }),
  }),
  Type.Object({
    type: Type.Literal("list"),
    items: Type.Array(str(L.item), { minItems: 1, maxItems: L.items }),
    numbered: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    type: Type.Literal("checklist"),
    items: Type.Array(Type.Object({ text: str(L.item), state: Type.Union([Type.Literal("done"), Type.Literal("doing"), Type.Literal("todo")]) }), {
      minItems: 1,
      maxItems: L.items,
      description: "Steps and how far each has got.",
    }),
  }),
  Type.Object({ type: Type.Literal("code"), code: str(L.code), language: Type.Optional(Type.String({ maxLength: 20 })) }),
  Type.Object({
    type: Type.Literal("diff"),
    diff: str(L.code, "A unified diff: lines starting with +, - or a space (and @@ hunk headers)."),
    file: Type.Optional(Type.String({ maxLength: 200 })),
  }),
]);

/** What the schema can't say: every table row fits its columns. */
function problem(blocks: CardBlock[]): string | undefined {
  for (const [i, b] of blocks.entries()) {
    if (b.type === "table") {
      const bad = b.rows.findIndex((r) => r.length !== b.columns.length);
      if (bad >= 0) return `Block ${i + 1}: row ${bad + 1} has ${b.rows[bad].length} cells, but the table has ${b.columns.length} columns.`;
    }
  }
}

/** `show_card`: post a card in the chat right away; the turn goes on. */
export function showCardCapability(post: (card: SprocketCard) => void): Capability {
  let shown = 0;
  return {
    name: "show_card",
    description: `Show your user a card in this chat right away, drawn by Rails: a table (comparing options, figures), facts (label and value), a list, a checklist (steps and how far each got), code or a diff. Use it when structure helps; most replies are plain text. A card is read-only: your user can't tick, edit or click anything in it, so to update it, show a new one. The card holds the structured part; your advice and opinions go in your message, not in the card's text blocks (keep those to a line). Your turn goes on: add a sentence or two if useful, but never write out what the card already shows. At most ${CARDS_MAX} per turn.`,
    params: Type.Object({
      title: Type.Optional(Type.String({ maxLength: L.title })),
      blocks: Type.Array(block, { minItems: 1, maxItems: L.blocks }),
    }),
    effect: "act",
    echo: true,
    log: { doing: () => "Showing a card", done: (calls) => `showed ${calls.length === 1 ? "a card" : `${calls.length} cards`}` },
    run: async ({ title, blocks }: { title?: string; blocks: CardBlock[] }) => {
      const wrong = problem(blocks);
      if (wrong) throw new Error(wrong);
      if (++shown > CARDS_MAX) throw new Error(`You've shown ${CARDS_MAX} cards this turn: put the rest in one card, or in your reply.`);
      post({ ...(title?.trim() ? { title: title.trim() } : {}), blocks });
      return "Shown: your user sees the card now. Don't write its contents out again; add a sentence or two only if there's something it doesn't say.";
    },
  };
}
