import { useEffect, useRef, useState } from "react";
import { SPROCKET_CHARACTERS, SPROCKET_COLORS, type SprocketCharacter, type SprocketColor } from "@rails/shared";
import { Dropdown } from "../ui/Dropdown.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { Switch } from "../ui/Switch.tsx";
import { ANIMATIONS } from "./animations.ts";
import { CHARACTERS } from "./characters.ts";
import { DANCE, EXPRESSIONS, GLANCE, SPIN, THINKING, type ExpressionName, type Gesture } from "./clips.ts";
import { blink, express, leanIn, play, type Activity, type Rig } from "./engine.ts";
import { clock, kick, setSpeed, stepClock } from "./motion.ts";
import { COLOR_NAMES } from "./names.ts";
import { Sprocket } from "./Sprocket.tsx";
import type { Stance } from "./solid.ts";

/** Every gesture by name: the thinking moves, then the rest. */
const GESTURES: Record<string, Gesture> = { ...Object.fromEntries(Object.entries(THINKING).map(([n, m]) => [n, m.steps])), glance: GLANCE, spin: SPIN, dance: DANCE };
const HOLD = { yaw: [-180, 180, 0], pitch: [-60, 60, 0], roll: [-45, 45, 0], near: [0.8, 1.3, 1] } as const;
type Held = Record<keyof typeof HOLD, number>;

/**
 * The Sprocket lab (ADR 0035), in dev builds only (`#/lab`): a Sprocket, or every character, in any stance and
 * activity; any gesture, expression, blink or lean-in played on cue; a pose held with sliders; and the motion clock
 * slowed, paused and stepped.
 */
export default function SprocketLab() {
  const [character, setCharacter] = useState<SprocketCharacter>("bean");
  const [color, setColor] = useState<SprocketColor>("green");
  const [size, setSize] = useState("160");
  const [stance, setStance] = useState<Stance>("rest");
  const [follow, setFollow] = useState(false);
  const [activity, setActivity] = useState<Activity>("idle");
  const [speed, setSpeedState] = useState("1");
  const [all, setAll] = useState(false);
  const [holding, setHolding] = useState(false);
  const [held, setHeld] = useState<Held>({ yaw: 0, pitch: 0, roll: 0, near: 1 });
  const rigs = useRef(new Map<string, Rig>());
  // A finished animation plays as it does in the app: its activity for as long as it lasts, then back.
  const [playing, setPlaying] = useState<keyof typeof ANIMATIONS | null>(null);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(null), ANIMATIONS[playing].ms / Math.max(Number(speed), 0.05));
    return () => clearTimeout(t);
  }, [playing]);

  const each = (fn: (r: Rig, now: number) => void) => {
    const now = clock();
    rigs.current.forEach((r) => fn(r, now));
    kick();
  };
  useEffect(() => each((r) => (r.hold = holding ? held : null)), [holding, held]);
  // Leaving the lab leaves motion running in real time.
  useEffect(() => () => setSpeed(1), []);

  const shown = all ? SPROCKET_CHARACTERS : [character];
  const track = (key: string) => (r: Rig | null) => {
    if (r) {
      rigs.current.set(key, r);
      r.hold = holding ? held : null;
    } else rigs.current.delete(key);
  };

  return (
    <div className="page lab">
      <h1 className="lab-title">Sprocket lab</h1>
      <p className="muted">Dev builds only. Play any clip, hold a pose, and slow the motion clock down to look closely.</p>
      <div className="lab-body">
        <div className="lab-controls">
          <section aria-labelledby="lab-animations">
            <h2 id="lab-animations" className="lab-h">Animations</h2>
            {(Object.keys(ANIMATIONS) as (keyof typeof ANIMATIONS)[]).map((a) => (
              <div key={a} className="lab-animation">
                <button className="btn" aria-pressed={playing === a} onClick={() => setPlaying(a)}>
                  {ANIMATIONS[a].name}
                </button>
                <span className="muted">{ANIMATIONS[a].when}</span>
              </div>
            ))}
          </section>

          <section aria-labelledby="lab-look">
            <h2 id="lab-look" className="lab-h">Look</h2>
            <div className="lab-row">
              <span>Character</span>
              <Dropdown label="Character" value={character} options={SPROCKET_CHARACTERS.map((c) => ({ value: c, label: CHARACTERS[c].name }))} onChange={(v) => setCharacter(v as SprocketCharacter)} />
            </div>
            <div className="lab-row">
              <span>Colour</span>
              <Dropdown label="Colour" value={color} options={SPROCKET_COLORS.map((c) => ({ value: c, label: COLOR_NAMES[c] }))} onChange={(v) => setColor(v as SprocketColor)} />
            </div>
            <div className="lab-row">
              <span id="lab-size">Size</span>
              <Segmented name="lab-size" aria-labelledby="lab-size" small value={size} onChange={setSize} options={["26", "50", "100", "160"].map((v) => ({ value: v, label: v }))} />
            </div>
            <div className="lab-row">
              <label htmlFor="lab-all">Every character</label>
              <Switch id="lab-all" checked={all} onChange={setAll} />
            </div>
          </section>

          <section aria-labelledby="lab-state">
            <h2 id="lab-state" className="lab-h">State</h2>
            <div className="lab-row">
              <span id="lab-stance">Stance</span>
              <Segmented name="lab-stance" aria-labelledby="lab-stance" small value={stance} onChange={(v) => setStance(v as Stance)} options={[{ value: "rest", label: "Rest" }, { value: "front", label: "Front" }, { value: "toward", label: "Toward" }]} />
            </div>
            <div className="lab-row">
              <span id="lab-activity">Activity</span>
              <Segmented name="lab-activity" aria-labelledby="lab-activity" small value={activity} onChange={(v) => setActivity(v as Activity)} options={[{ value: "idle", label: "Idle" }, { value: "think", label: "Think" }, { value: "write", label: "Write" }, { value: "cheer", label: "Cheer" }]} />
            </div>
            <div className="lab-row">
              <label htmlFor="lab-follow">Follow the pointer</label>
              <Switch id="lab-follow" checked={follow} onChange={setFollow} />
            </div>
          </section>

          <section aria-labelledby="lab-clock">
            <h2 id="lab-clock" className="lab-h">Clock</h2>
            <div className="lab-row">
              <span id="lab-speed">Speed</span>
              <Segmented
                name="lab-speed"
                aria-labelledby="lab-speed"
                small
                value={speed}
                onChange={(v) => {
                  setSpeedState(v);
                  setSpeed(Number(v));
                }}
                options={[{ value: "0", label: "Paused" }, ...["0.1", "0.25", "0.5", "1", "2"].map((v) => ({ value: v, label: `${v}×` }))]}
              />
            </div>
            <div className="lab-row">
              <span>Step</span>
              <span className="lab-buttons">
                <button className="btn" onClick={() => stepClock(16)}>
                  One frame
                </button>
                <button className="btn" onClick={() => stepClock(100)}>
                  100 ms
                </button>
              </span>
            </div>
          </section>

          <section aria-labelledby="lab-gestures">
            <h2 id="lab-gestures" className="lab-h">Parts: gestures</h2>
            <div className="lab-buttons">
              {Object.keys(GESTURES).map((g) => (
                <button key={g} className="btn" onClick={() => each((r, now) => play(r, g, GESTURES[g], now))}>
                  {g}
                </button>
              ))}
              <button className="btn" onClick={() => each(leanIn)}>
                lean in
              </button>
            </div>
          </section>

          <section aria-labelledby="lab-face">
            <h2 id="lab-face" className="lab-h">Parts: face</h2>
            <div className="lab-buttons">
              {(Object.keys(EXPRESSIONS) as ExpressionName[]).map((e) => (
                <button key={e} className="btn" onClick={() => each((r, now) => express(r, e, now))}>
                  {e}
                </button>
              ))}
              <button className="btn" onClick={() => each(blink)}>
                blink
              </button>
            </div>
          </section>

          <section aria-labelledby="lab-hold">
            <h2 id="lab-hold" className="lab-h">Hold a pose</h2>
            <div className="lab-row">
              <label htmlFor="lab-holding">Hold</label>
              <Switch id="lab-holding" checked={holding} onChange={setHolding} />
            </div>
            {(Object.keys(HOLD) as (keyof Held)[]).map((k) => (
              <div key={k} className="lab-row">
                <label htmlFor={`lab-${k}`}>{k}</label>
                <input id={`lab-${k}`} type="range" min={HOLD[k][0]} max={HOLD[k][1]} step={k === "near" ? 0.01 : 1} value={held[k]} disabled={!holding} onChange={(e) => setHeld({ ...held, [k]: Number(e.target.value) })} />
                <output className="lab-value" htmlFor={`lab-${k}`}>
                  {held[k]}
                </output>
              </div>
            ))}
          </section>
        </div>

        <div className={"lab-stage" + (all ? " all" : "")}>
          {shown.map((c) => (
            <Sprocket key={c} look={{ character: c, color }} size={Number(size)} stance={stance} follow={follow} activity={playing ? ANIMATIONS[playing].activity : activity} label={CHARACTERS[c].name} onRig={track(c)} />
          ))}
        </div>
      </div>
    </div>
  );
}
