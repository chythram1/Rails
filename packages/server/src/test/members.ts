// Scripted team members for tests (ADR 0033): members run at once, so one queue of faux replies would go to whoever
// calls first. Each call here answers as the member whose instructions it got ("- Bo (you)"), from that member's
// own queue; a member with nothing left stays quiet.
import { fauxAssistantMessage, type AssistantMessage, type FauxResponseStep, type TranscriptContext } from "@earendil-works/pi-ai";

type Step = AssistantMessage | ((c: TranscriptContext) => AssistantMessage | Promise<AssistantMessage>);

/** Everything a scripted model call was given, the system prompt first. */
export const seen = (c: TranscriptContext) =>
  c.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join(""))).join("\n");

const QUIET = () => fauxAssistantMessage("(quiet)");

/**
 * Set `faux`'s replies: each member's steps in order, quiet once they run out. Returns how many model calls each
 * member got, so a test can check who was woken.
 */
export function scriptMembers(faux: { setResponses(r: FauxResponseStep[]): void }, script: Record<string, Step[]>, calls = 40): Record<string, number> {
  const queues = new Map(Object.entries(script).map(([name, steps]) => [name, [...steps]]));
  const count: Record<string, number> = {};
  const answer = (c: TranscriptContext) => {
    const name = seen(c).match(/^- (.+?) \(you\)/m)?.[1] ?? "?";
    count[name] = (count[name] ?? 0) + 1;
    const next = queues.get(name)?.shift();
    return !next ? QUIET() : typeof next === "function" ? next(c) : next;
  };
  faux.setResponses(Array.from({ length: calls }, () => answer));
  return count;
}
