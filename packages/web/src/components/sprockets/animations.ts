// A Sprocket's animations (ADR 0035): the finished, polished set, each saying when it plays and what it's made of.
// They're built from the parts in clips.ts, and every one shares the same blinks, expressions and leaning in, so a
// Sprocket behaves the same way wherever it is. Each plays once, for a set time, then the Sprocket goes back to
// resting. What's left to decide per animation is when it plays.
import type { SprocketMessage } from "@rails/shared";
import { BREATHE, DANCE, DAYDREAM, DOZE, DROOP, FOCUS, HOORAY, HUM, IDEA, INSPECT, LOOK_AROUND, NOD, NOTIFY, PUZZLED, RUMMAGE, STREAM, STRETCH, SURVEY, TWIRL, type Gesture, type Moves } from "./clips.ts";

/** One finished animation. */
export interface Animation {
  name: string;
  /** When it plays, in words (the lab shows it). */
  when: string;
  /** Idle (now and then while it rests) or activity (while it works on a message, or once it's done). */
  kind: "idle" | "activity";
  /** An activity's moment: in flight (thinking or typing), or done (after it has finished: celebrating, mostly). */
  moment?: "in flight" | "done";
  /** The activity (engine.ts) that plays it in the app, if one does. */
  activity?: "cheer" | "talk" | "satisfied";
  /** How long it lasts, its eyes included: one piece, so they go with it. Then it rests. */
  ms: number;
  /** What its body does: a gesture it plays as it starts (springs carry it), or keyframed moves on its own clock. */
  gesture?: Gesture;
  moves?: Moves;
  /** How often it comes up among the idle ones (1 if left out). */
  weight?: number;
  /** Its eyes for the whole time: happy (^ ^), or round (dilated circles, popping in); or faces in its moves. */
  eyes?: "happy" | "round";
}

export const ANIMATIONS = {
  cheer: {
    name: "Cheer",
    kind: "activity",
    moment: "done",
    when: "Its message lands, in any chat: beside the message, and on its row in the list.",
    activity: "cheer",
    ms: 3000, // the dance and wobble (2.8s), and a moment for the eyes to ease back as it settles
    moves: DANCE,
    eyes: "happy",
  },
  satisfied: {
    name: "Satisfied",
    kind: "activity",
    moment: "done",
    when: "Not placed in the app yet.",
    activity: "satisfied",
    ms: 2500, // the bounce and wobble (2.25s), and a moment for the eyes to ease back as it settles
    moves: NOD,
    eyes: "happy",
  },
  survey: {
    name: "Survey",
    kind: "activity",
    moment: "in flight",
    when: "It starts writing a reply in a team chat: the team's thinking icon, and its row in the list.",
    activity: "talk",
    ms: 2900, // one scan out and back (2.6s), and a moment for the eyes to ease back as it settles
    gesture: SURVEY,
    eyes: "round",
  },
  // Idle: now and then while it rests (the lab plays them on Grok-like timing; not in the app yet).
  breathe: { name: "Breathe", kind: "idle", when: "Resting: the one it plays most.", ms: 4000, moves: BREATHE, weight: 4 },
  lookAround: { name: "Look around", kind: "idle", when: "Resting.", ms: 6000, moves: LOOK_AROUND },
  daydream: { name: "Daydream", kind: "idle", when: "Resting.", ms: 6000, moves: DAYDREAM },
  doze: { name: "Doze", kind: "idle", when: "Resting, after a long while untouched.", ms: 6000, moves: DOZE },
  hum: { name: "Hum", kind: "idle", when: "Resting.", ms: 4000, moves: HUM },
  stretch: { name: "Stretch", kind: "idle", when: "Resting.", ms: 3200, moves: STRETCH },
  // Activity, not placed yet: in flight (thinking or typing) and done (once it has finished: celebrating, or stuck).
  stream: { name: "Stream", kind: "activity", moment: "in flight", when: "Writing its reply.", ms: 2700, moves: STREAM },
  focus: { name: "Focus", kind: "activity", moment: "in flight", when: "Working on something.", ms: 2500, moves: FOCUS },
  idea: { name: "Idea", kind: "activity", moment: "in flight", when: "Thinking it through.", ms: 4000, moves: IDEA },
  inspect: { name: "Inspect", kind: "activity", moment: "in flight", when: "Reading or looking something up.", ms: 4900, moves: INSPECT },
  rummage: { name: "Rummage", kind: "activity", moment: "in flight", when: "Using a tool.", ms: 5100, moves: RUMMAGE },
  notify: { name: "Notify", kind: "activity", moment: "done", when: "It finished with something for you (a question, a card to act on).", ms: 1300, moves: NOTIFY },
  puzzled: { name: "Puzzled", kind: "activity", moment: "done", when: "It finished stuck or blocked.", ms: 2100, moves: PUZZLED },
  droop: { name: "Droop", kind: "activity", moment: "done", when: "It finished, but something failed.", ms: 3000, moves: DROOP },
  hooray: { name: "Hooray", kind: "activity", moment: "done", when: "It finished: excited.", ms: 2100, moves: HOORAY },
  twirl: { name: "Twirl", kind: "activity", moment: "done", when: "It finished something big: a celebration.", ms: 3000, moves: TWIRL },
} satisfies Record<string, Animation>;
export type AnimationName = keyof typeof ANIMATIONS;

/** The animation an activity plays, if it has one. */
export const animationFor = (activity: string): Animation | undefined => Object.values(ANIMATIONS as Record<string, Animation>).find((a) => a.activity === activity);

/** The idle animations, for a rig that plays them now and then (engine.ts setIdles). */
export const IDLES: Animation[] = Object.values(ANIMATIONS as Record<string, Animation>).filter((a) => a.kind === "idle");

/** Rails' notices that a run stopped short of a reply without failing: a cap it hit (runs.ts). */
const STOPPED = /^(Stopped after|Paused)/;

/**
 * What a Sprocket plays once its reply is done, by how it ended (`m`, its newest message or Rails' notice about it):
 * stopped short, Puzzled; failed, Droop; asking the user something or offering a card to act on, Notify; otherwise
 * a celebration, Cheer, Satisfied or Hooray, and now and then Twirl. The pick is fixed by the message's id, so it's
 * the same wherever and however often it's drawn.
 */
export function doneFor(m: Pick<SprocketMessage, "id" | "author" | "text" | "ask" | "card">): AnimationName {
  if (m.author === "notice") return STOPPED.test(m.text) ? "puzzled" : "droop";
  if ((m.ask && !m.ask.answer) || m.card?.actions?.length) return "notify";
  let h = 0;
  for (const c of m.id) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const n = (h >>> 0) % 10;
  return n === 0 ? "twirl" : (["cheer", "satisfied", "hooray"] as const)[n % 3];
}

