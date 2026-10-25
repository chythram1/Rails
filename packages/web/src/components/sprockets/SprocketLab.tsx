import { useEffect, useRef, useState } from "react";
import { SPROCKET_CHARACTERS, SPROCKET_COLORS, type SprocketCharacter, type SprocketColor } from "@rails/shared";
import { Dropdown } from "../ui/Dropdown.tsx";
import { Segmented } from "../ui/Segmented.tsx";
import { Switch } from "../ui/Switch.tsx";
import { ANIMATIONS, IDLES, type AnimationName } from "./animations.ts";
import { CHARACTERS } from "./characters.ts";
import { EXPRESSIONS, GLANCE, SPIN, THINKING, type ExpressionName, type Gesture } from "./clips.ts";
import { blink, express, leanIn, perform, play, setIdles, type Activity, type Rig } from "./engine.ts";
import { TeamThinking } from "./TeamThinking.tsx";
import { clock, kick, setSpeed, stepClock } from "./motion.ts";
import { COLOR_NAMES } from "./names.ts";
import { Sprocket, VIEW } from "./Sprocket.tsx";
import type { Stance } from "./solid.ts";

/** Every gesture by name: the thinking moves, then the rest. */
const GESTURES: Record<string, Gesture> = { ...Object.fromEntries(Object.entries(THINKING).map(([n, m]) => [n, m.steps])), glance: GLANCE, spin: SPIN };
const HOLD = { yaw: [-180, 180, 0], pitch: [-60, 60, 0], roll: [-45, 45, 0], near: [0.8, 1.3, 1] } as const;
type Held = Record<keyof typeof HOLD, number>;

/**
 * The Sprocket lab (ADR 0035), in dev builds only (`#/lab`): a Sprocket, or every character, in any stance and
 * activity; any gesture, expression, blink or lean-in played on cue; a pose held with sliders; and the motion clock
 * slowed, paused and stepped.
 */
export default function SprocketLab() {
  const [character, setCharacter] = useState<SprocketCharacter>("blob");
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
  // A finished animation plays on every Sprocket shown, for as long as it lasts.
  const [playing, setPlaying] = useState<AnimationName | null>(null);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying(null), ANIMATIONS[playing].ms / Math.max(Number(speed), 0.05));
    return () => clearTimeout(t);
  }, [playing]);
  const [idling, setIdling] = useState(false);
  const [chats, setChats] = useState(false);
  const [dots, setDots] = useState(false);
  useEffect(() => {
    if (!dots) return;
    const t = setTimeout(() => setDots(false), 2500 / Math.max(Number(speed), 0.05));
    return () => clearTimeout(t);
  }, [dots]);
  // A reply, played as a Grok bot's goes. Direct: its own face working, the dots while it thinks, typing, then the
  // in-flight icon goes and its row (the same drawing) celebrates. Team: the icon goes through the members until the
  // replies land, then goes; nothing is left to celebrate.
  const [direct, setDirect] = useState<"working" | "thinking" | "typing" | null>(null);
  const [team, setTeam] = useState(false);
  const later = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => later.current.forEach(clearTimeout), []);
  const at = (ms: number, fn: () => void) => later.current.push(setTimeout(fn, ms / Math.max(Number(speed), 0.05)));
  const onDirect = (a: AnimationName) => {
    const r = rigs.current.get("direct");
    if (r) perform(r, ANIMATIONS[a], clock());
    kick();
  };
  const playDirect = () => {
    setDirect("working");
    onDirect("focus");
    at(2500, () => setDirect("thinking"));
    at(4700, () => {
      setDirect("typing");
      onDirect("stream");
    });
    at(7400, () => {
      setDirect(null);
      onDirect("cheer");
    });
  };
  const playTeam = () => {
    setTeam(true);
    at(6000, () => setTeam(false));
  };

  const each = (fn: (r: Rig, now: number) => void) => {
    const now = clock();
    rigs.current.forEach((r) => fn(r, now));
    kick();
  };
  useEffect(() => each((r) => (r.hold = holding ? held : null)), [holding, held]);
  useEffect(() => each((r, now) => setIdles(r, idling ? IDLES : null, now)), [idling]);
  const perform1 = (a: AnimationName) => {
    setPlaying(a);
    each((r, now) => perform(r, ANIMATIONS[a], now));
  };
  const group = (kind: "idle" | "activity", moment?: "in flight" | "done") => (Object.keys(ANIMATIONS) as AnimationName[]).filter((a) => ANIMATIONS[a].kind === kind && (!moment || (ANIMATIONS[a] as { moment?: string }).moment === moment));
  const buttons = (names: AnimationName[]) =>
    names.map((a) => (
      <div key={a} className="lab-animation">
        <button className="btn" aria-pressed={playing === a} onClick={() => perform1(a)}>
          {ANIMATIONS[a].name}
        </button>
        <span className="muted">{ANIMATIONS[a].when}</span>
      </div>
    ));
  // Leaving the lab leaves motion running in real time.
  useEffect(() => () => setSpeed(1), []);

  const shown = all ? SPROCKET_CHARACTERS : [character];
  const track = (key: string) => (r: Rig | null) => {
    if (r) {
      rigs.current.set(key, r);
      r.hold = holding ? held : null;
      if (idling) setIdles(r, IDLES, clock());
    } else rigs.current.delete(key);
  };

  return (
    <div className="page lab">
      <h1 className="lab-title">Sprocket lab</h1>
      <p className="muted">Dev builds only. Play any clip, hold a pose, and slow the motion clock down to look closely.</p>
      <div className="lab-body">
        <div className="lab-controls">
          <section aria-labelledby="lab-idle">
            <h2 id="lab-idle" className="lab-h">Animations: idle</h2>
            <div className="lab-row">
              <label htmlFor="lab-idling">Now and then while resting</label>
              <Switch id="lab-idling" checked={idling} onChange={setIdling} />
            </div>
            {buttons(group("idle"))}
          </section>

          <section aria-labelledby="lab-flight">
            <h2 id="lab-flight" className="lab-h">Animations: in flight</h2>
            <div className="lab-row">
              <label htmlFor="lab-chats">Show a direct and a team chat</label>
              <Switch id="lab-chats" checked={chats} onChange={setChats} />
            </div>
            <div className="lab-animation">
              <button className="btn" aria-pressed={dots} onClick={() => setDots(true)}>
                Dots
              </button>
              <span className="muted">Thinking in a direct chat: it becomes an ellipsis. Not in a team chat.</span>
            </div>
            {buttons(group("activity", "in flight"))}
          </section>

          <section aria-labelledby="lab-done">
            <h2 id="lab-done" className="lab-h">Animations: done</h2>
            <p className="muted lab-note">Once it has finished typing. Seen on its row in the list: a direct chat's in-flight icon is the row's own drawing, and a team chat leaves no icon behind.</p>
            {buttons(group("activity", "done"))}
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
              <Segmented name="lab-stance" aria-labelledby="lab-stance" small value={stance} onChange={(v) => setStance(v as Stance)} options={[{ value: "rest", label: "Rest" }, { value: "front", label: "Front" }]} />
            </div>
            <div className="lab-row">
              <span id="lab-activity">Activity</span>
              <Segmented name="lab-activity" aria-labelledby="lab-activity" small value={activity} onChange={(v) => setActivity(v as Activity)} options={[{ value: "idle", label: "Idle" }, { value: "think", label: "Think" }, { value: "write", label: "Write" }, { value: "cheer", label: "Cheer" }, { value: "talk", label: "Talk" }]} />
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

        <div className="lab-stages">
          <div className={"lab-stage" + (all ? " all" : "")}>
            {shown.map((c) => (
              <Sprocket key={c} look={{ character: c, color }} size={Number(size)} stance={stance} follow={follow} activity={activity} dots={dots} label={CHARACTERS[c].name} onRig={track(c)} />
            ))}
          </div>
          {chats && (
            <div className="lab-chats">
              <figure className="lab-chat">
                <figcaption className="muted">Direct chat: the icon by a reply in flight is its row's own drawing, so they move exactly alike; once it's done the icon goes and the row celebrates.</figcaption>
                <div className="lab-chat-row">
                  <Sprocket id="lab-direct" look={{ character, color }} size={50} stance="rest" activity={activity} dots={direct === "thinking"} onRig={track("direct")} />
                  <span>{CHARACTERS[character].name}</span>
                </div>
                <div className="lab-chat-flight">
                  {direct ? (
                    <>
                      <svg className="lab-flight" viewBox={`0 0 50 ${(50 * VIEW.h) / VIEW.w}`} aria-hidden>
                        <use href="#lab-direct" />
                      </svg>
                      <span className="muted">{direct === "working" ? "Working on it…" : direct === "thinking" ? "Mulling it over…" : "Typing…"}</span>
                    </>
                  ) : (
                    <button className="btn" onClick={playDirect}>
                      Play a reply
                    </button>
                  )}
                </div>
              </figure>
              <figure className="lab-chat">
                <figcaption className="muted">Team chat: the icon goes through the members on its own, apart from their rows, never as dots; once the replies land it goes, so there's nothing left to celebrate.</figcaption>
                <div className="lab-chat-flight">
                  {team ? (
                    <>
                      <TeamThinking looks={SPROCKET_CHARACTERS.slice(0, 3).map((c, i) => ({ id: c, look: { character: c, color: SPROCKET_COLORS[(SPROCKET_COLORS.indexOf(color) + i) % SPROCKET_COLORS.length] } }))} size={26} />
                      <span className="muted">{SPROCKET_CHARACTERS.slice(0, 3).map((c) => CHARACTERS[c].name).join(", ")} are working…</span>
                    </>
                  ) : (
                    <button className="btn" onClick={playTeam}>
                      Play a reply
                    </button>
                  )}
                </div>
              </figure>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
