import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, normalizeContext, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { resendWhenSilent } from "./resend.ts";

const model = fauxProvider().getModel();
const context = normalizeContext({ messages: [] });

/** A request that says nothing until it's aborted, then ends as an aborted one does. */
function silent(signal: AbortSignal | undefined): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  signal?.addEventListener("abort", () => {
    const error = { ...fauxAssistantMessage(""), stopReason: "aborted" as const, errorMessage: "Request was aborted" };
    s.push({ type: "error", reason: "aborted", error });
  });
  return s;
}

/** A request that answers at once. */
function answers(text: string): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  const message = fauxAssistantMessage(text);
  queueMicrotask(() => {
    s.push({ type: "start", partial: message });
    s.push({ type: "done", reason: "stop", message });
  });
  return s;
}

describe("resendWhenSilent", () => {
  it("sends a request again when it hears nothing, and gives the answer of the one that answers", async () => {
    let sent = 0;
    const send: StreamFn = (_m, _c, o) => (++sent < 3 ? silent(o?.signal) : answers("Hi"));
    const result = await (await resendWhenSilent(send, 20)(model, context)).result();
    expect(sent).toBe(3);
    expect(result.stopReason).toBe("stop");
    expect(result.content).toEqual([{ type: "text", text: "Hi" }]);
  });

  it("ends in a timeout error (which a run retries) when every request is silent", async () => {
    let sent = 0;
    const send: StreamFn = (_m, _c, o) => (sent++, silent(o?.signal));
    const result = await (await resendWhenSilent(send, 20, 1)(model, context)).result();
    expect(sent).toBe(2);
    expect(result).toMatchObject({ stopReason: "error", errorMessage: expect.stringMatching(/timed out/) });
  });

  it("leaves a request that has started answering alone, however long it takes", async () => {
    let sent = 0;
    const send: StreamFn = () => {
      sent++;
      const s = createAssistantMessageEventStream();
      const message = fauxAssistantMessage("Slow");
      s.push({ type: "start", partial: message });
      setTimeout(() => s.push({ type: "done", reason: "stop", message }), 60);
      return s;
    };
    const result = await (await resendWhenSilent(send, 20)(model, context)).result();
    expect(sent).toBe(1);
    expect(result.stopReason).toBe("stop");
  });

  it("stops when the run is aborted, without sending again", async () => {
    let sent = 0;
    const abort = new AbortController();
    const send: StreamFn = (_m, _c, o) => (sent++, silent(o?.signal));
    const stream = await resendWhenSilent(send, 1000)(model, context, { signal: abort.signal });
    abort.abort();
    expect((await stream.result()).stopReason).toBe("aborted");
    expect(sent).toBe(1);
  });
});
