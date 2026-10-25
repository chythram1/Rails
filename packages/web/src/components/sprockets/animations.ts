// A Sprocket's animations (ADR 0035): the finished, polished set, each saying when it plays and what it's made of.
// They're built from the parts in clips.ts, and every one shares the same blinks, expressions and leaning in, so a
// Sprocket behaves the same way wherever it is. What's left to decide per animation is when it plays.
import { DANCE, SURVEY, type Gesture } from "./clips.ts";

/** One finished animation. */
export interface Animation {
  name: string;
  /** When it plays, in words (the lab shows it). */
  when: string;
  /** What the Sprocket is doing while it plays (engine.ts's activity). */
  activity: "cheer" | "talk";
  /** How long it lasts, its eyes included (one piece, so they go with it); null for as long as its activity does. */
  ms: number | null;
  /** The gesture it plays as it starts, and whether it repeats until the animation ends. */
  gesture: Gesture;
  loop: boolean;
  /** Its eyes for the whole time: happy (^ ^), or round (dilated circles, popping in). */
  eyes: "happy" | "round";
}

export const ANIMATIONS = {
  cheer: {
    name: "Cheer",
    when: "Its message lands, in any chat: beside the message, and on its row in the list.",
    activity: "cheer",
    ms: 2200, // the dance (1.9s), and a moment for the eyes to ease back as it settles
    gesture: DANCE,
    loop: false,
    eyes: "happy",
  },
  survey: {
    name: "Survey",
    when: "It's writing a reply in a team chat: the team's thinking icon, and its row in the list.",
    activity: "talk",
    ms: null,
    gesture: SURVEY,
    loop: true,
    eyes: "round",
  },
} satisfies Record<string, Animation>;

/** The animation an activity plays, if it has one. */
export const animationFor = (activity: string): Animation | undefined => Object.values(ANIMATIONS).find((a) => a.activity === activity);
