// Rails' mod for Claude Code (ADR 0028). Rails loads it with `--plugin-dir` in the panels it starts (a copy in
// RAILS_HOME, since Claude Code writes type files into a mod's folder). While Claude's question dialog
// (AskUserQuestion) is open, it waits for an answer from Rails too: the user's own answer in the panel and one sent
// from a Sprocket's chat race, and the first wins. An answer from Rails closes the dialog and reaches Claude as the
// user's answer. Nothing else changes: without Rails (no RAILS_BRIDGE) the mod does nothing.

export function register(on) {
  on("tool.call", { tool: "AskUserQuestion" }, async ($, e, next) => {
    const base = await $.env.get("RAILS_BRIDGE");
    const token = await $.env.get("RAILS_PANEL_TOKEN");
    const questions = Array.isArray(e.questions) ? e.questions : [];
    // Only a single question with a known id: several are answered in the panel, as before.
    const id = e.tool_use_id;
    if (!base || !token || questions.length !== 1 || typeof id !== "string" || !id) return next(e);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const post = (path, body) => $.http.fetch(`${base}/claude/${path}`, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => {});

    const q = questions[0];
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => (typeof o?.label === "string" ? o.label : "")).filter(Boolean);
    let settled = false;
    // Tell Rails the dialog can be answered from it, by this tool call's id.
    await post("dialog", { id, question: q.question, options });

    const panel = next(e).then(
      (result) => ({ from: "panel", result }),
      (error) => ({ from: "error", error }),
    );
    const rails = (async () => {
      // Rails holds each poll up to 25 s (a fetch may take 30), so this asks again until something settles.
      while (!settled) {
        let messages = [];
        try {
          const r = await $.http.fetch(`${base}/claude/inbox`, { headers });
          if (r.ok) messages = JSON.parse(r.text || "{}").messages ?? [];
          else await $.clock.sleep(2000);
        } catch {
          await $.clock.sleep(2000); // Rails is down or restarting: the panel can still answer
        }
        for (const m of messages) {
          const mine = !settled && m?.answer?.dialog === id && typeof m.answer.text === "string" && m.answer.text.trim() !== "";
          void post("delivered", { id: m?.id, ok: mine, ...(mine ? {} : { error: "The dialog has closed." }) });
          if (mine) return { from: "rails", text: m.answer.text.trim() };
        }
      }
      return { from: "none" };
    })();

    const won = await Promise.race([panel, rails]);
    settled = true;
    if (won.from === "rails") return { result: { questions, answers: { [q.question]: won.text } } };
    if (won.from === "error") throw won.error;
    return won.result;
  });
}
