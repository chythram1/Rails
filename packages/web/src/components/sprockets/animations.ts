// A Sprocket's animations (ADR 0035): the finished, polished set, each saying when it plays and what it's made of.
// They're built from the parts in clips.ts, and every one shares the same blinks, expressions and leaning in, so a
// Sprocket behaves the same way wherever it is. What's left to decide per animation is when it plays.
import { DANCE, type Gesture } from "./clips.ts";

/** One finished animation. */
export interface Animation {
  name: string;
  /** When it plays, in words (the lab shows it). */
  when: string;
  /** What the Sprocket is doing while it plays (engine.ts's activity). */
  activity: "cheer";
  /** How long it lasts. */
  ms: number;
  /** The gesture it plays as it starts. */
  gesture: Gesture;
  /** Its eyes for the whole time: happy (^ ^). */
  eyes: "happy";
}

export const ANIMATIONS = {
  cheer: {
    name: "Cheer",
    when: "Its message lands, in any chat: beside the message, and on its row in the list.",
    activity: "cheer",
    ms: 5000,
    gesture: DANCE,
    eyes: "happy",
  },
} satisfies Record<string, Animation>;
