import { describe, expect, it } from "vitest";
import { IDLE_FIRST, IDLE_GAP, REST_POSE, advance, createRig, express, perform, setIdles, setInput, setResting, type Activity, type Frame, type Input, type Rig } from "./engine.ts";
import { ANIMATIONS, IDLES } from "./animations.ts";
import { BLINK_MS, FACES, FACE_MS, faceAt, lidAt } from "./clips.ts";
import { POSES, poseOf, type Stance } from "./solid.ts";

/** A seeded random source, so a run's choices replay. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const input = (activity: Activity, stance: Stance = "rest", more: Partial<Input> = {}): Input => ({ stance, follow: false, activity, faceOnly: false, ...more });
const rig = (i: Input, seed = 1) => createRig(i, poseOf(i.stance), 0, seeded(seed));

/** Run `r` frame by frame (16ms) for `ms`, calling `see` with each frame. */
function run(r: Rig, ms: number, see: (f: Frame, r: Rig) => void = () => {}, pointer: [number, number] | null = null) {
  let last: Frame | undefined;
  const [start, end] = [r.clock, r.clock + ms];
  for (let t = start + 16; t <= end; t += 16) {
    last = advance(r, t, pointer).frame;
    see(last, r);
  }
  return last!;
}

describe("a Sprocket's motion engine", () => {
  it("thinking plays one move after another, never the same twice running", () => {
    const r = rig(input("think"));
    const moves: string[] = [];
    run(r, 120_000, (_, r) => {
      if (r.gesture && r.gesture.i === 1 && moves.at(-1) !== `${r.gesture.name}@${r.gesture.at}`) moves.push(`${r.gesture.name}@${r.gesture.at}`);
    });
    const names = moves.map((m) => m.split("@")[0]);
    expect(names.length).toBeGreaterThan(50);
    expect(new Set(names).size).toBe(8);
    names.forEach((n, i) => i && expect(n).not.toBe(names[i - 1]));
  });

  it("leaning in glances to the viewer's left, leading over the move's own turn", () => {
    const r = rig(input("think"), 3);
    let seen = 0;
    run(r, 30_000, (f, r) => {
      if (r.near > 0 && r.lean && r.lean.i > 1) {
        seen++;
        if (seen > 30) {
          expect(f.pose.slide).toBeLessThan(-3);
          expect(f.look[0]).toBeLessThan(0);
        }
      }
    });
    expect(seen).toBeGreaterThan(100);
  });

  it("cheering: happy eyes and a dance bouncing side to side, then back to its open eyes", () => {
    const r = rig(input("idle", "rest"));
    setInput(r, input("cheer", "rest"), r.clock);
    let [lo, hi, up, airborneWide] = [0, 0, 0, 1];
    const f = run(r, 2000, (f) => {
      lo = Math.min(lo, f.pose.slide);
      hi = Math.max(hi, f.pose.slide);
      up = Math.max(up, f.pose.hop);
      if (f.pose.hop > 2) airborneWide = Math.max(airborneWide, f.pose.sx);
    });
    expect(f.happy).toBeGreaterThan(0.95);
    expect(lo).toBeLessThan(-6);
    expect(hi).toBeGreaterThan(6);
    expect(up).toBeGreaterThan(12);
    expect(airborneWide).toBeLessThan(1.05); // it squashes on the ground, not in the air
    expect(run(r, 1000).pose.slide).toBeCloseTo(0, 0); // back in the middle
    setInput(r, input("idle", "rest"), r.clock);
    expect(run(r, 1000).happy).toBeLessThan(0.05);
  });

  it("a blink shuts quickly, rests a beat and opens softly", () => {
    expect(lidAt(0)).toBe(0);
    expect(lidAt(BLINK_MS * 0.32)).toBeCloseTo(1, 2);
    expect(lidAt(BLINK_MS * 0.4)).toBe(1);
    expect(lidAt(BLINK_MS * 0.7)).toBeLessThan(0.3); // opens softly: most of the way by then
    expect(lidAt(BLINK_MS)).toBe(0);
  });

  it("following the pointer turns and tips toward it, eyes on it", () => {
    const r = rig(input("idle", "front", { follow: true }));
    const f = run(r, 2000, () => {}, [0.5, -0.4]);
    expect(f.pose.yaw).toBeGreaterThan(15);
    expect(f.pose.pitch).toBeGreaterThan(8);
    expect(f.look[0]).toBeGreaterThan(3);
  });

  it("with only the face moving, it holds its stance but still blinks", () => {
    const r = rig(input("think", "rest", { faceOnly: true }));
    let blinked = false;
    run(r, 15_000, (f) => {
      expect(f.pose.yaw).toBeCloseTo(POSES.rest.yaw, 5);
      if (f.lid > 0.5) blinked = true;
    });
    expect(r.gesture).toBeNull();
    expect(blinked).toBe(true);
  });

  it("writing spins round once; holding still, it sleeps until the next blink", () => {
    const r = rig(input("write", "rest"));
    expect(run(r, 2000).pose.yaw).toBeCloseTo(POSES.rest.yaw + 360, 0);
    const f = rig(input("idle", "front"));
    run(f, 3000);
    const out = advance(f, f.clock + 16, null);
    if (!out.moving) {
      expect(out.wake).toBeGreaterThan(0);
      expect(out.wake).toBeLessThan(6000);
    }
  });

  it("an expression changes the eyes and settles back to how they're drawn", () => {
    const r = rig(input("idle", "front"));
    express(r, "squeeze", r.clock);
    const mid = run(r, 400);
    expect(mid.left.sx).toBeGreaterThan(1.1);
    expect(mid.left.dx).toBeGreaterThan(2);
    expect(mid.right.dx).toBeLessThan(-2);
    const end = run(r, 1000);
    expect(end.left).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });

  it("surveying: the eyes pop round, scan an upside-down arc once, then it rests with open eyes", () => {
    const r = rig(input("idle", "rest"));
    setInput(r, input("talk", "rest"), r.clock);
    const popped = run(r, 200);
    expect(popped.left.sx).toBeGreaterThan(1.5); // round within a fifth of a second
    expect(popped.left.sy).toBeLessThan(0.85);
    const path: [number, number][] = [];
    run(r, 2400, (f) => path.push(f.look));
    const xs = path.map(([x]) => x);
    expect(Math.min(...xs)).toBeLessThan(-5);
    expect(Math.max(...xs)).toBeGreaterThan(5);
    // Lowest in the middle, higher at the ends: ∪.
    const near = (pred: (x: number) => boolean) => path.filter(([x]) => pred(x)).map(([, y]) => y);
    expect(Math.min(...near((x) => Math.abs(x) < 1.5))).toBeGreaterThan(Math.max(...near((x) => Math.abs(x) > 6)));
    // Over on time, though it's still writing: open eyes, and resting (a glance planned, no survey).
    const after = run(r, 1200);
    expect(after.left.sx).toBeCloseTo(1, 1);
    expect(r.anim).toBeNull();
    expect(r.gesture?.name ?? "").not.toBe("Survey");
    expect(r.nextGlance).toBeLessThan(Infinity);
  });

  it("satisfied: happy eyes and an elastic nod, squashing and stretching in place, then it rests", () => {
    const r = rig(input("idle", "rest"));
    setInput(r, input("satisfied", "rest"), r.clock);
    let [wide, tall, up, slide, airborneWide, lid] = [1, 1, 0, 0, 1, 0];
    const f = run(r, 2200, (f) => {
      wide = Math.max(wide, f.pose.sx);
      tall = Math.min(tall, f.pose.sx);
      up = Math.max(up, f.pose.hop);
      slide = Math.max(slide, Math.abs(f.pose.slide));
      if (f.pose.hop > 2) airborneWide = Math.max(airborneWide, f.pose.sx);
      lid = Math.max(lid, f.lid);
    });
    expect(f.happy).toBeGreaterThan(0.95);
    expect(wide).toBeGreaterThan(1.08); // squashed wide
    expect(tall).toBeLessThan(0.92); // stretched tall
    expect(up).toBeGreaterThan(15);
    expect(airborneWide).toBeLessThan(1.05); // it squashes on the ground, not in the air
    expect(lid).toBe(0); // ^ ^ eyes don't blink
    expect(slide).toBeLessThan(0.5); // in place: no side to side
    expect(run(r, 1200).happy).toBeLessThan(0.05); // over on time
  });

  it("idle animations: one after another while resting, on a Grok bot's timing, the rarer ones never twice running", () => {
    const r = rig(input("idle"));
    setIdles(r, IDLES, r.clock);
    const plays: { name: string; at: number; ended: number }[] = [];
    let current: string | null = null;
    run(r, 300_000, (_, r) => {
      const name = r.anim ? r.lastIdle!.name : null;
      if (name && (name !== current || r.anim!.start !== plays.at(-1)?.at)) plays.push({ name, at: r.anim!.start, ended: r.anim!.until });
      current = name;
    });
    expect(plays.length).toBeGreaterThan(20);
    expect(plays[0].at).toBeGreaterThanOrEqual(IDLE_FIRST[0]);
    expect(plays[0].at).toBeLessThanOrEqual(IDLE_FIRST[1] + 16);
    for (let i = 1; i < plays.length; i++) {
      const gap = plays[i].at - plays[i - 1].ended;
      expect(gap).toBeGreaterThanOrEqual(IDLE_GAP[0] - 16);
      expect(gap).toBeLessThanOrEqual(IDLE_GAP[1] + 32);
      if (plays[i].name !== "Breathe") expect(plays[i].name).not.toBe(plays[i - 1].name);
    }
    expect(new Set(plays.map((p) => p.name)).size).toBe(IDLES.length);
    // Breathe comes up most.
    const count = (n: string) => plays.filter((p) => p.name === n).length;
    expect(count("Breathe")).toBeGreaterThan(count("Doze"));
  });

  it("idle animations stop the moment it has something to do, and wait a beat to start again", () => {
    const r = rig(input("idle"));
    setIdles(r, IDLES, r.clock);
    run(r, 5000);
    setInput(r, input("think"), r.clock);
    expect(r.anim).toBeNull();
    run(r, 5000, (_, r) => expect(r.anim).toBeNull());
    setInput(r, input("idle"), r.clock);
    const back = r.clock;
    let started = 0;
    run(r, 5000, (_, r) => (started ||= r.anim ? r.clock : 0));
    expect(started - back).toBeGreaterThanOrEqual(IDLE_FIRST[0]);
  });

  it("an animation's faces blend in and out, and it blinks only where it says", () => {
    const r = rig(input("idle", "rest"));
    perform(r, ANIMATIONS.doze, r.clock);
    const lids: number[] = [];
    let narrowest = 1;
    run(r, ANIMATIONS.doze.ms, (f) => {
      lids.push(f.lid);
      narrowest = Math.min(narrowest, f.left.sy);
    });
    expect(narrowest).toBeLessThan(0.3); // sleepy
    // Doze blinks once, near its end; no other blink lands on its sleepy eyes.
    const shut = lids.map((l, i) => (l > 0.9 ? i * 16 : -1)).filter((t) => t >= 0);
    expect(shut.length).toBeGreaterThan(0);
    expect(Math.min(...shut)).toBeGreaterThan(5500);
    // A face key blends over FACE_MS.
    const keys: [number, keyof typeof FACES][] = [[100, "wide"]];
    expect(faceAt(keys, 100).mix).toBe(0);
    expect(faceAt(keys, 100 + FACE_MS / 2).mix).toBeCloseTo(0.5, 1);
    expect(faceAt(keys, 100 + FACE_MS).mix).toBe(1);
  });

  it("every animation starts and ends at rest, so one can follow another without a jump", () => {
    for (const a of Object.values(ANIMATIONS)) {
      const r = rig(input("idle", "rest"));
      perform(r, a, r.clock);
      const first = run(r, 16);
      const last = run(r, a.ms + 600);
      expect(Math.abs(first.pose.hop), a.name).toBeLessThan(1);
      expect(Math.abs(last.pose.hop), a.name).toBeLessThan(0.5);
      expect(Math.abs(last.pose.sx - 1), a.name).toBeLessThan(0.02);
      expect(Math.abs(last.pose.slide), a.name).toBeLessThan(0.5);
      expect(Math.abs(last.pose.near - 1), a.name).toBeLessThan(0.02);
      const turned = (((last.pose.yaw - POSES.rest.yaw) % 360) + 360) % 360;
      expect(Math.min(turned, 360 - turned), a.name).toBeLessThan(1); // facing the same way (whole turns look the same)
      expect(last.happy, a.name).toBeLessThan(0.05);
    }
  });

  it("resting: it holds the pose it has beside its messages, still, not blinking, until it's woken", () => {
    const r = rig(input("idle"));
    setResting(r, true, r.clock);
    run(r, 3000);
    let [lid, moving] = [0, false];
    let last: Frame | undefined;
    for (let t = r.clock + 16, end = r.clock + 20_000; t <= end; t += 16) {
      const out = advance(r, t, null);
      lid = Math.max(lid, out.frame.lid);
      moving ||= out.moving;
      last = out.frame;
    }
    expect(lid).toBe(0); // no blinks
    expect(moving).toBe(false); // nothing to draw: the loop sleeps
    expect(last!.pose.yaw).toBeCloseTo(POSES[REST_POSE].yaw, 0);
    expect(last!.pose.pitch).toBeCloseTo(POSES[REST_POSE].pitch, 0);
    setResting(r, false, r.clock);
    let blinked = false;
    run(r, 8000, (f) => (blinked ||= f.lid > 0.5));
    expect(blinked).toBe(true);
  });

  it("resting waits for what's playing: a done animation or an idle one plays out first", () => {
    const r = rig(input("idle"));
    perform(r, ANIMATIONS.cheer, r.clock);
    run(r, 300);
    setResting(r, true, r.clock);
    let happy = 0;
    run(r, 1500, (f) => (happy = Math.max(happy, f.happy)));
    expect(happy).toBeGreaterThan(0.9); // still cheering
    const settled = run(r, 4000);
    expect(settled.happy).toBeLessThan(0.05);
    expect(settled.pose.yaw).toBeCloseTo(POSES[REST_POSE].yaw, 0);
  });

  it("following the pointer wakes a resting Sprocket, and it settles back after", () => {
    const r = rig(input("idle"));
    setResting(r, true, r.clock);
    run(r, 3000);
    setInput(r, input("idle", "rest", { follow: true }), r.clock);
    const looking = run(r, 1500, () => {}, [-1, 0]);
    expect(looking.pose.yaw).toBeLessThan(-20);
    setInput(r, input("idle"), r.clock);
    expect(run(r, 3000).pose.yaw).toBeCloseTo(POSES[REST_POSE].yaw, 0);
  });
});

