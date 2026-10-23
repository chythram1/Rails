import { IconCircle as Todo, IconCircleCheckFilled as Done, IconProgress as Doing } from "@tabler/icons-react";
import type { CardBlock, CheckState, SprocketCard } from "@rails/shared";
import { diffLineClass } from "../GitPanel.tsx";
import { CardActions } from "./CardActions.tsx";

/**
 * A card a Sprocket showed (ADR 0024, server harness/cards.ts): Rails draws it from its own components, so it reads
 * like the rest of the app. A square card on `--surface` with its edge, the title on a rule, then its blocks, ruled
 * apart: a table (small capitals over its columns, a rule between rows), facts, a list, a checklist (state colours
 * with words for screen readers), code and a diff in Space Mono. Its actions (ADR 0031) come last.
 */
export function Card({ card, messageId }: { card: SprocketCard; messageId?: string }) {
  const acts = !!messageId && !!card.actions?.length;
  return (
    <section className={"chat-card" + (acts ? " acting" : "")} aria-label={card.title ?? "Card"}>
      {card.title && <h3 className="chat-card-title">{card.title}</h3>}
      {card.blocks.map((b, i) => (
        <div key={i} className={"chat-card-block " + b.type}>
          <Block block={b} />
        </div>
      ))}
      {acts && <CardActions messageId={messageId} actions={card.actions!} />}
    </section>
  );
}

const STATE: Record<CheckState, { label: string; icon: typeof Done }> = {
  done: { label: "Done", icon: Done },
  doing: { label: "In progress", icon: Doing },
  todo: { label: "To do", icon: Todo },
};

function Block({ block: b }: { block: CardBlock }) {
  switch (b.type) {
    case "text":
      return <p className="chat-card-text">{b.text}</p>;
    case "table":
      return (
        <div className="chat-card-scroll">
          <table className="chat-card-table">
            <thead>
              <tr>{b.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "facts":
      return (
        <dl className="chat-card-facts">
          {b.items.map((f, i) => (
            <div key={i}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "list": {
      const List = b.numbered ? "ol" : "ul";
      return <List className="chat-card-list">{b.items.map((t, i) => <li key={i}>{t}</li>)}</List>;
    }
    case "checklist": {
      const done = b.items.filter((i) => i.state === "done").length;
      return (
        <>
          <p className="chat-card-count">{done} of {b.items.length} done</p>
          <ul className="chat-card-checks">
            {b.items.map((item, i) => {
              const { label, icon: Icon } = STATE[item.state];
              return (
                <li key={i} className={item.state}>
                  <Icon size={16} aria-hidden />
                  <span className="sr-only">{label}: </span>
                  <span>{item.text}</span>
                </li>
              );
            })}
          </ul>
        </>
      );
    }
    case "code":
      return (
        <pre className="chat-card-code" aria-label={b.language ? `${b.language} code` : "Code"}>
          <code>{b.code}</code>
        </pre>
      );
    case "diff":
      return (
        <>
          {b.file && <p className="chat-card-file">{b.file}</p>}
          <pre className="chat-card-code diff" aria-label={b.file ? `Changes to ${b.file}` : "Changes"}>
            {b.diff.split("\n").map((l, i) => (
              <div key={i} className={diffLineClass(l)}>{l || " "}</div>
            ))}
          </pre>
        </>
      );
  }
}
