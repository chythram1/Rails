// A Sprocket's animations (ADR 0035): the finished, polished set, each saying when it plays and what it's made of.
// They're built from the parts in clips.ts, and every one shares the same blinks, expressions and leaning in, so a
// Sprocket behaves the same way wherever it is. Each plays once, for a set time, then the Sprocket goes back to
// resting. What's left to decide per animation is when it plays.
import { DANCE, NOD, SURVEY, type Gesture, type Moves } from "./clips.ts";

/** One finished animation. */
export interface Animation {
  name: string;
  /** When it plays, in words (the lab shows it). */
  when: string;
  /** What the Sprocket is doing while it plays (engine.ts's activity). */
  activity: "cheer" | "talk" | "satisfied";
  /** How long it lasts, its eyes included: one piece, so they go with it. Then it rests. */
  ms: number;
  /** What its body does: a gesture it plays as it starts (springs carry it), or keyframed moves on its own clock. */
  gesture?: Gesture;
  moves?: Moves;
  /** Its eyes for the whole time: happy (^ ^), or round (dilated circles, popping in). */
  eyes: "happy" | "round";
}

export const ANIMATIONS = {
  cheer: {
    name: "Cheer",
    when: "Its message lands, in any chat: beside the message, and on its row in the list.",
    activity: "cheer",
    ms: 3000, // the dance and wobble (2.8s), and a moment for the eyes to ease back as it settles
    moves: DANCE,
    eyes: "happy",
  },
  satisfied: {
    name: "Satisfied",
    when: "Not placed in the app yet.",
    activity: "satisfied",
    ms: 2500, // the bounce and wobble (2.25s), and a moment for the eyes to ease back as it settles
    moves: NOD,
    eyes: "happy",
  },
  survey: {
    name: "Survey",
    when: "It starts writing a reply in a team chat: the team's thinking icon, and its row in the list.",
    activity: "talk",
    ms: 2900, // one scan out and back (2.6s), and a moment for the eyes to ease back as it settles
    gesture: SURVEY,
    eyes: "round",
  },
} satisfies Record<string, Animation>;

/** The animation an activity plays, if it has one. */
export const animationFor = (activity: string): Animation | undefined => Object.values(ANIMATIONS).find((a) => a.activity === activity);
