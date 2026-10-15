import { memo } from "react";
import Markdown from "react-markdown";
import type { Message } from "@rails/shared";

type ToolUse = Extract<Message, { kind: "tool_use" }>;
type ToolResult = Extract<Message, { kind: "tool_result" }>;

export const MessageList = memo(function MessageList({ messages }: { messages: Message[] }) {
  const results = new Map<string, ToolResult>();
  for (const m of messages) if (m.kind === "tool_result") results.set(m.toolUseId, m);

  return (
    <>
      {messages.map((m) => {
        switch (m.kind) {
          case "user":
            return (
              <div key={m.id} className="msg user">
                <div className="bubble">{m.text}</div>
              </div>
            );
          case "assistant":
            return (
              <div key={m.id} className="msg assistant md">
                <Markdown>{m.text}</Markdown>
              </div>
            );
          case "thinking":
            return (
              <details key={m.id} className="msg aux">
                <summary>Thinking</summary>
                <div className="aux-body pre">{m.text}</div>
              </details>
            );
          case "tool_use":
            return <Tool key={m.id} use={m} result={results.get(m.toolUseId)} />;
          case "tool_result":
            return null; // rendered with its tool_use
          case "system":
            return (
              <div key={m.id} className="msg system muted small">
                {m.text}
              </div>
            );
        }
      })}
    </>
  );
});

function Tool({ use, result }: { use: ToolUse; result?: ToolResult }) {
  const state = !result ? "pending" : result.isError ? "error" : "ok";
  return (
    <details className={"msg aux tool t-" + state}>
      <summary>
        <span className="tool-name">{use.name}</span>
        <span className="tool-arg truncate">{summarize(use.input)}</span>
        {state === "error" && <span className="tool-flag">failed</span>}
      </summary>
      <div className="aux-body">
        <pre className="code">{typeof use.input === "string" ? use.input : JSON.stringify(use.input, null, 2)}</pre>
        {result && <pre className={"code" + (result.isError ? " err" : "")}>{clip(result.output)}</pre>}
      </div>
    </details>
  );
}

function summarize(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const k of ["command", "file_path", "path", "pattern", "url", "query", "description", "prompt"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  const first = Object.values(o).find((v) => typeof v === "string");
  return (first as string) ?? "";
}

const clip = (s: string, max = 20_000) => (s.length > max ? s.slice(0, max) + `\n… (${s.length - max} more chars)` : s);
