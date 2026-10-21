// Model requests that get no answer at all are sent again. Now and then a request to a provider hears nothing back
// (a ChatGPT connection that went quiet): waiting it out (REQUEST_TIMEOUT_MS in runs.ts), then the retry's pause,
// kept a Sprocket silent for two minutes, and a team's round with it.
import { createAssistantMessageEventStream, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

/**
 * `send`, but a request whose provider hasn't started answering (its first event) after `silentMs` is dropped and
 * sent again, up to `resends` times. A request that has started answering is left to finish. If the last one is
 * silent too, it ends in a timeout error, which the run retries as any other (runs.ts).
 */
export function resendWhenSilent(send: StreamFn, silentMs: number, resends = 2): StreamFn {
  return async (model, context, options) => {
    const out = createAssistantMessageEventStream();
    const request = async () => {
      const abort = new AbortController();
      const stop = () => abort.abort();
      options?.signal?.addEventListener("abort", stop);
      const done = () => options?.signal?.removeEventListener("abort", stop);
      try {
        return { stream: await send(model, context, { ...options, signal: abort.signal }), abort, done };
      } catch (e) {
        done();
        throw e;
      }
    };
    // The first request's failure to start is the caller's, as without this.
    let current = await request();
    void (async () => {
      for (let n = 0; ; n++) {
        const req = current;
        let heard = false;
        let silent = false;
        let ended: AssistantMessageEvent | undefined; // how the dropped request ended
        const timer = setTimeout(() => {
          if (heard) return;
          silent = true;
          req.abort.abort();
        }, silentMs);
        try {
          for await (const e of req.stream) {
            if (silent) {
              if (e.type === "error") ended = e;
              continue;
            }
            heard = true;
            out.push(e);
          }
        } finally {
          clearTimeout(timer);
          req.done();
        }
        if (!silent) return out.end();
        // Dropped for its silence: send it again, or say it timed out.
        if (options?.signal?.aborted) return ended ? out.push(ended) : out.end();
        const seconds = Math.round(silentMs / 1000);
        const timedOut: AssistantMessageEvent = {
          type: "error",
          reason: "error",
          error: {
            role: "assistant",
            content: [],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "error",
            errorMessage: `The model didn't answer: timed out after ${seconds} s`,
            timestamp: Date.now(),
          },
        };
        if (n >= resends) return out.push(timedOut);
        console.warn(`sprockets: no answer from ${model.provider}/${model.id} in ${seconds} s, sending it again`);
        try {
          current = await request();
        } catch {
          return out.push(timedOut);
        }
      }
    })().catch((e) => {
      console.error("sprockets: model request:", e);
      out.end();
    });
    return out;
  };
}
