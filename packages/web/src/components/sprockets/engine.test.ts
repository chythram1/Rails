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

  it("cheering: happy eyes and a dance rocking both ways, then back to its open eyes", () => {
    const r = rig(input("idle", "toward"));
    setInput(r, input("cheer", "toward"), r.clock);
    let [lo, hi] = [0, 0];
    const f = run(r, 1500, (f) => {
      lo = Math.min(lo, f.pose.roll);
      hi = Math.max(hi, f.pose.roll);
    });
    expect(f.happy).toBeGreaterThan(0.95);
    expect(lo).toBeLessThan(-10);
    expect(hi).toBeGreaterThan(10);
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
});
