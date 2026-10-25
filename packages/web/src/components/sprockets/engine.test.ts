import { describe, expect, it } from "vitest";
import { advance, createRig, express, setInput, type Activity, type Frame, type Input, type Rig } from "./engine.ts";
import { BLINK_MS, lidAt } from "./clips.ts";
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
    const r = rig(input("idle", "toward"));
    setInput(r, input("cheer", "toward"), r.clock);
    let [lo, hi, up] = [0, 0, 0];
    const f = run(r, 1500, (f) => {
      lo = Math.min(lo, f.pose.slide);
      hi = Math.max(hi, f.pose.slide);
      up = Math.max(up, f.pose.hop);
    });
    expect(f.happy).toBeGreaterThan(0.95);
    expect(lo).toBeLessThan(-6);
    expect(hi).toBeGreaterThan(6);
    expect(up).toBeGreaterThan(6);
    expect(run(r, 1500).pose.slide).toBeCloseTo(0, 0); // back in the middle
    setInput(r, input("idle", "toward"), r.clock);
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
    const r = rig(input("idle", "toward"));
    setInput(r, input("satisfied", "toward"), r.clock);
    let [wide, tall, up, slide, airborneWide, lid] = [1, 1, 0, 0, 1, 0];
    const f = run(r, 1100, (f) => {
      wide = Math.max(wide, f.pose.sx);
      tall = Math.min(tall, f.pose.sx);
      up = Math.max(up, f.pose.hop);
      slide = Math.max(slide, Math.abs(f.pose.slide));
      if (f.pose.hop > 2) airborneWide = Math.max(airborneWide, f.pose.sx);
      lid = Math.max(lid, f.lid);
    });
    expect(f.happy).toBeGreaterThan(0.95);
    expect(wide).toBeGreaterThan(1.18); // squashed wide
    expect(tall).toBeLessThan(0.88); // stretched tall
    expect(up).toBeGreaterThan(15);
    expect(airborneWide).toBeLessThan(1.05); // it squashes on the ground, not in the air
    expect(lid).toBe(0); // ^ ^ eyes don't blink
    expect(slide).toBeLessThan(0.5); // in place: no side to side
    expect(run(r, 1000).happy).toBeLessThan(0.05); // over on time
  });
});
