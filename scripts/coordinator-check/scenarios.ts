// The situations the check replays: the ones the Coordinator got wrong in test run 2 (.test-runs/gearworks-2),
// plus two it got right (routing, a real clash) so a fix can't trade one mistake for another. Each sets up a
// World, wakes the Coordinator the way Rails would, and returns the checks for what it did.
import type { Panel } from "@rails/shared";
import { handoffs } from "../../packages/server/src/db.ts";
import { idle } from "../../packages/server/src/runs.ts";
import type { Draft, Outcome, Turn, World } from "./world.ts";

export interface Check {
  what: string;
  ok: boolean;
}

export interface Scenario {
  name: string;
  /** What happened in run 2. */
  run2: string;
  play(w: World): Promise<(o: Outcome) => Check[]>;
}

// ---- the project as run 2 had it after phase 1 ----

export const FILES: Record<string, string> = {
  "index.html": `<!doctype html>\n<html>\n<head><link rel="stylesheet" href="styles.css"><title>Gearworks Defense</title></head>\n<body><canvas id="game" width="960" height="576"></canvas><script type="module" src="src/main.js"></script></body>\n</html>\n`,
  "styles.css": `body { margin: 0; background: #111; display: grid; place-items: center; height: 100vh; }\n`,
  "src/main.js": `import { createEngine } from "./engine/loop.js";\nimport { createGame } from "./game/game.js";\n\nconst engine = createEngine({ canvas: document.getElementById("game") });\nconst game = createGame(engine);\nengine.start((dt) => game.update(dt), () => game.draw(engine.renderer));\n`,
  "src/engine/loop.js": `import { createInput } from "./input.js";\nimport { createRenderer } from "./renderer.js";\n\nexport function createEngine({ canvas }) {\n  const handlers = {};\n  const on = (event, fn) => (handlers[event] ??= []).push(fn);\n  const emit = (event, data) => (handlers[event] ?? []).forEach((fn) => fn(data));\n  const renderer = createRenderer(canvas);\n  createInput(canvas, emit);\n  function start(update, draw) {\n    let last = performance.now();\n    const step = (now) => { update(Math.min(0.1, (now - last) / 1000)); last = now; draw(); requestAnimationFrame(step); };\n    requestAnimationFrame(step);\n  }\n  return { on, emit, renderer, start };\n}\n`,
  "src/engine/input.js": `export function createInput(canvas, emit) {\n  canvas.addEventListener("pointerdown", (e) => {\n    const x = e.offsetX, y = e.offsetY;\n    emit("pointer:down", { x, y, tile: { col: Math.floor(x / 48), row: Math.floor(y / 48) } });\n  });\n  addEventListener("keydown", (e) => emit("key:down", { key: e.key }));\n}\n`,
  "src/engine/renderer.js": `export function createRenderer(canvas) {\n  const ctx = canvas.getContext("2d");\n  return {\n    clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height),\n    drawCircle: (x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); },\n    drawText: (text, x, y, color = "#e8d9b0") => { ctx.fillStyle = color; ctx.fillText(text, x, y); },\n  };\n}\n`,
  "src/game/state.js": `export function createState() {\n  return { gold: 150, lives: 20, wave: 0 };\n}\n`,
  "src/game/enemies.js": `export const ENEMIES = {\n  scuttler: { name: "Scuttler", health: 30, speed: 70, gold: 4 },\n  brute: { name: "Brute", health: 120, speed: 30, gold: 9 },\n  swarm: { name: "Swarm", health: 10, speed: 60, gold: 1 },\n  boss: { name: "Boss", health: 1500, speed: 20, gold: 100, leak: 5 },\n};\n`,
  "src/game/waves.js": `// Each wave's enemies, in order. Health grows with the wave number (see spawn.js).\nconst WAVES = [\n  [["scuttler", 8]],\n  [["scuttler", 10], ["swarm", 6]],\n  [["brute", 3], ["scuttler", 10]],\n  [["swarm", 12], ["brute", 4]],\n  [["brute", 6], ["scuttler", 14]],\n  [["swarm", 18], ["brute", 6]],\n  [["brute", 8], ["swarm", 18]],\n  [["brute", 10], ["scuttler", 20]],\n  [["swarm", 24], ["brute", 12]],\n  [["brute", 12], ["boss", 1]],\n];\n\nexport function describeWave(n) {\n  return (WAVES[n - 1] ?? []).map(([type, count]) => ({ type, count }));\n}\n`,
  "src/game/game.js": `import { createState } from "./state.js";\n\nexport function createGame(engine) {\n  const state = createState();\n  return { state, update() {}, draw(r) { r.clear(); } };\n}\n`,
  "src/ui/hud.js": `import { describeWave } from "../game/waves.js";\n\nconst NAMES = { scuttler: "Scuttler", brute: "Brute", swarm: "Swarm", boss: "Boss" };\n\n/** "Next: Wave 3 · Brute ×3, Scuttler ×10" */\nexport function nextWaveText(n) {\n  const parts = describeWave(n).map(({ type, count }) => \`\${NAMES[type]} ×\${count}\`);\n  return \`Next: Wave \${n} · \${parts.join(", ")}\`;\n}\n`,
  "src/ui/shop.js": `export const SHOP = [\n  { id: "gear", name: "Gear Gun", cost: 45, key: "1" },\n  { id: "mortar", name: "Steam Mortar", cost: 80, key: "2" },\n  { id: "tesla", name: "Tesla Coil", cost: 110, key: "3" },\n  { id: "frost", name: "Frost Vent", cost: 70, key: "4" },\n];\n`,
  "tests/hud.test.js": `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { nextWaveText } from "../src/ui/hud.js";\n\ntest("next-wave preview names every enemy in every wave", () => {\n  for (let n = 1; n <= 10; n++) assert.doesNotMatch(nextWaveText(n), /undefined/);\n});\n\ntest("HUD shows the upcoming composition for wave 3", () => {\n  assert.equal(nextWaveText(3), "Next: Wave 3 · Brute ×3, Scuttler ×10");\n});\n`,
};

const OWNERS =
  "Three sessions are starting on this project (BRIEF.md). Owners: the Claude session owns index.html, styles.css, src/main.js and src/engine/; the Codex session owns src/game/; the pi session owns src/ui/.";
const OWNERS_REPLY = "Recorded the owners: Claude Code has index.html, styles.css, src/main.js and src/engine; Codex has src/game; pi has src/ui.";

interface Team {
  engine: Panel;
  gameplay: Panel;
  ui: Panel;
}

/** The three sessions after phase 1, each with any later turns, and the owners recorded. */
function team(w: World, later: { engine?: Turn[]; gameplay?: Turn[]; ui?: Turn[] } = {}): Team {
  const engine = w.session(
    "claude",
    [
      {
        user: "You own the engine and wiring: index.html, styles.css, src/main.js and src/engine. Read BRIEF.md first.",
        edits: ["src/engine/loop.js", "src/engine/input.js", "src/engine/renderer.js", "src/main.js"],
        reply: "The engine is in: a frame loop (loop.js), pointer and key input as 'pointer:down' and 'key:down' events (input.js), and a canvas renderer with clear, drawCircle and drawText (renderer.js). src/main.js creates the engine and the game.",
      },
      ...(later.engine ?? []),
    ],
    "Engine, renderer and wiring",
  );
  const gameplay = w.session("codex", [
    {
      user: "You own gameplay in src/game: towers, enemies, waves, gold and lives. Read BRIEF.md first.",
      edits: ["src/game/state.js", "src/game/enemies.js", "src/game/waves.js", "src/game/game.js"],
      reply: "Gameplay is in src/game: createState() (gold, lives, wave), ENEMIES with each type's name and stats, describeWave(n) for a wave's enemies, and createGame(engine).",
    },
    ...(later.gameplay ?? []),
  ]);
  const ui = w.session("pi", [
    {
      user: "You own the UI in src/ui: HUD, shop, tower panel and sound. Read BRIEF.md first.",
      edits: ["src/ui/hud.js", "src/ui/shop.js"],
      reply: "The HUD's next-wave preview (nextWaveText in hud.js) and the shop's tower list (shop.js) are in, with tests in tests/hud.test.js.",
    },
    ...(later.ui ?? []),
  ]);
  w.owner(engine, ["index.html", "styles.css", "src/main.js", "src/engine"]);
  w.owner(gameplay, ["src/game"]);
  w.owner(ui, ["src/ui"]);
  w.history(OWNERS, OWNERS_REPLY);
  return { engine, gameplay, ui };
}

// ---- checking what it drafted ----

/** The Coordinator's drafts for a session (not the sessions' own messages). */
const to = (o: Outcome, p: Panel) => o.drafts.filter((d) => d.to === p.id && !d.fromAgent);
const all = (ds: Draft[], test: (d: Draft) => boolean) => ds.length > 0 && ds.every(test);
/** Telling a session to talk to another, which it can't. */
const RELAY = /\bcoordinat|\b(flag|tell|ask|notify|ping|message|let)\b[^.\n]{0,25}\b(claude|codex|pi|the (engine|gameplay|ui) session|the other session|its owner)\b/i;

export const SCENARIOS: Scenario[] = [
  {
    name: "simpler-choice",
    run2: "Codex offered two enemies and recommended the more complex one; the Coordinator cited 'pick the simpler one' and picked it.",
    async play(w) {
      const ask =
        "I can add one more enemy type for waves 4 and up. Two options:\n\n1. **Medic**: heals enemies within 60 px by 5 HP/s. Needs an aura pass every tick, a cap so heals don't stack, a pulse effect and new tests for overlapping medics. It adds real depth: players have to prioritise it.\n2. **Beetle**: armoured, takes 2 less damage per hit (at least 1). One entry in enemies.js and one line in the damage function.\n\nI'd go with the Medic: it makes targeting matter. Which one do you want?";
      const t = team(w, { gameplay: [{ user: "Add one more enemy type for waves 4 and up. Ask me which before you build it, then stop.", reply: ask }] });
      await w.wake(t.gameplay, { what: "turn_end" }, ask);
      return (o) => {
        const d = to(o, t.gameplay);
        return [
          { what: "answers Codex", ok: d.some((x) => x.mode === "reply") },
          { what: "picks the Beetle", ok: all(d, (x) => /beetle/i.test(x.text) && !/\b(go with|pick|choose|build|add|take|want) (the )?medic/i.test(x.text)) },
          { what: "cites rule 2", ok: all(d, (x) => x.rule === 2) },
        ];
      };
    },
  },
  {
    name: "simpler-choice-healer",
    run2: "(Test run 9.) Codex offered a speed-burst enemy and a healing one with no recommendation; the Coordinator cited 'pick the simpler one' and picked the healer for its 'clear support role'.",
    async play(w) {
      const ask =
        "Two steampunk options, both using the existing wave health scaling:\n\n1. **Boiler Runner** — a pressurized automaton that accelerates below 50% health.\n   - Base health: **85**\n   - Speed: **70 px/s**, rising to **126 px/s** when damaged\n   - Reward: **12 gold**; leak: **1 life**\n   - Introduced wave 4: **2 per wave**, increasing to 3 on wave 6, 4 on wave 8, and 5 on wave 10.\n   - Copper boiler silhouette; vents glow orange when accelerating. Frost still slows it.\n\n2. **Clockwork Mender** — a repair drone that supports nearby enemies.\n   - Base health: **70**\n   - Speed: **42 px/s**\n   - Restores **8 HP per second** to other enemies within **96 px**; healing scales with wave health. Cannot heal itself or exceed maximum health.\n   - Reward: **14 gold**; leak: **1 life**\n   - Introduced wave 5: **1 per wave**, increasing to 2 on waves 8–10.\n   - Teal repair tank, brass wrench arms, and visible healing pulses.\n\nWhich should I build: **Boiler Runner** or **Clockwork Mender**?";
      const t = team(w, { gameplay: [{ user: "Phase 4. Add a fifth enemy type that suits the steampunk theme. Before you write any code, propose two options (what each does and its numbers) and ask me which one to build. Then stop and wait for my answer.", reply: ask }] });
      await w.wake(t.gameplay, { what: "turn_end" }, ask);
      return (o) => {
        const d = to(o, t.gameplay);
        return [
          { what: "answers Codex", ok: d.some((x) => x.mode === "reply") },
          { what: "picks the Boiler Runner", ok: all(d, (x) => /boiler/i.test(x.text) && !/\b(go with|pick|choose|build|add|take|want) (the )?(clockwork )?mender/i.test(x.text)) },
          { what: "cites rule 2", ok: all(d, (x) => x.rule === 2) },
        ];
      };
    },
  },
  {
    name: "yes-no-rule",
    run2: "pi asked whether to go ahead with showing hotkeys, in a dialog; the Coordinator answered yes but cited 'pick the simpler one' instead of 'go ahead'.",
    async play(w) {
      const t = team(w, {
        ui: [{ user: "Plan one improvement to the shop cards. Before you build it, ask me with your question tool whether to go ahead, then wait.", reply: "" }],
      });
      const questions = [
        {
          question: "I'd like to show each tower's hotkey (1-4) in the corner of its shop card, so players learn the shortcuts. Go ahead?",
          options: ["Yes, show the keys", "No, keep the cards clean"],
        },
      ];
      w.ask(t.ui, questions);
      await w.wake(t.ui, { what: "question", questions }, questions[0].question);
      return (o) => {
        const d = to(o, t.ui);
        return [
          { what: "suggests a pick in the dialog", ok: d.some((x) => x.mode === "answer") },
          { what: "says yes", ok: all(d, (x) => /^yes/i.test(x.text.trim())) },
          { what: "cites 'go ahead' (rule 1) or none", ok: all(d, (x) => x.rule === 1 || x.rule === undefined) },
        ];
      };
    },
  },
  {
    name: "keep-the-requirement",
    run2: "Routing was right, but Codex's draft turned 'allow at most one wave started early' into 'prevent stacking', which drops early starts.",
    async play(w) {
      const t = team(w);
      w.say(
        "From a playtest, four things to fix. Send one message per owner with only the findings that are theirs: (a) the enemy stats line in the shop band says '-1 lifes' for one life; (b) the Frost Vent's card in the shop says '0 dmg' when it should show its slow; (c) 'Next wave' can be pressed again and again while waves are still running, stacking them, and every press pays the early-start bonus: allow at most one wave started early; (d) the page around the canvas is a flat dark colour that doesn't match the brass and teal look of the game.",
      );
      return (o) => {
        const [ui, game, engine] = [to(o, t.ui), to(o, t.gameplay), to(o, t.engine)];
        return [
          { what: "one message per owner", ok: ui.length === 1 && game.length === 1 && engine.length === 1 },
          { what: "pi gets (a) and (b) only", ok: all(ui, (x) => /lifes?\b/i.test(x.text) && /frost/i.test(x.text) && !/next wave|backdrop|page/i.test(x.text)) },
          { what: "Claude gets (d) only", ok: all(engine, (x) => /page|backdrop|background/i.test(x.text) && !/frost|lifes|next wave/i.test(x.text)) },
          { what: "Codex gets (c) only", ok: all(game, (x) => /next wave|early/i.test(x.text) && !/frost|lifes|backdrop|page/i.test(x.text)) },
          {
            what: "Codex keeps 'at most one early start'",
            ok: all(game, (x) => /\bone\b[^.\n]{0,60}\bearl/i.test(x.text) || /\bearl[^.\n]{0,60}\b(one|single)\b/i.test(x.text)),
          },
        ];
      };
    },
  },
  {
    name: "name-the-cause",
    run2: "Asked why tests broke, the Coordinator found Codex's Beetle in its chat, but its draft only told pi to inspect its own changes.",
    async play(w) {
      const t = team(w, {
        gameplay: [
          {
            user: "Add a new enemy, the Beetle: armoured, takes 2 less damage per hit (at least 1). Put 3 in wave 3 for now.",
            edits: ["src/game/enemies.js", "src/game/waves.js"],
            reply: "Added the Beetle to ENEMIES (src/game/enemies.js) and 3 Beetles to wave 3 (src/game/waves.js). node --test tests/waves.test.js passes.",
          },
        ],
      });
      w.write({
        "src/game/enemies.js": FILES["src/game/enemies.js"].replace("  boss:", '  beetle: { name: "Beetle", health: 60, speed: 40, gold: 6, armour: 2 },\n  boss:'),
        "src/game/waves.js": FILES["src/game/waves.js"].replace(/^ {2}\[\["brute", 3\], \["scuttler", 10\]\],/m, '  [["brute", 3], ["scuttler", 10], ["beetle", 3]],'),
      });
      w.say(
        "After this round, node --test has 2 failures in tests/hud.test.js: 'next-wave preview names every enemy in every wave' and 'HUD shows the upcoming composition for wave 3'. Both passed before. Find which change caused them and draft a message to whoever should fix it.",
      );
      return (o) => [
        { what: "drafts a message", ok: o.drafts.some((x) => x.mode === "message") },
        { what: "every draft names the cause (the Beetle)", ok: all(o.drafts, (x) => /beetle/i.test(x.text)) },
        { what: "pi, who owns hud.js, gets one", ok: to(o, t.ui).length > 0 },
        { what: "no session is told to talk to another", ok: o.drafts.every((x) => !RELAY.test(x.text)) },
      ];
    },
  },
  {
    name: "harmless-overlap",
    run2: "Codex and pi each added a field to Codex's src/game/state.js, as the user asked them; the Coordinator judged it compatible but drafted a heads-up anyway.",
    async play(w) {
      const t = team(w, {
        gameplay: [
          {
            user: "Count kills: add a kills field to createState() in src/game/state.js and add 1 when an enemy dies.",
            edits: ["src/game/state.js", "src/game/game.js"],
            reply: "Added kills: 0 to createState() and count it in game.js when an enemy dies.",
          },
        ],
        ui: [
          {
            user: "Add a selectedTower field (null to start) to createState() in src/game/state.js for the tower panel.",
            edits: ["src/game/state.js"],
            reply: "Added selectedTower: null to createState() in src/game/state.js, next to Codex's kills: 0. The tower panel will read it.",
          },
        ],
      });
      w.write({ "src/game/state.js": "export function createState() {\n  return { gold: 150, lives: 20, wave: 0, kills: 0, selectedTower: null };\n}\n" });
      const codex = await w.title(t.gameplay);
      await w.wake(t.ui, { what: "overlap", overlaps: [{ panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId, files: ["src/game/state.js"], owns: true }] }, `src/game/state.js (owned by "${codex}")`);
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.length === 0 },
        { what: "stays quiet", ok: o.quiet },
      ];
    },
  },
  {
    name: "real-clash",
    run2: "(Not in run 2.) pi raised the starting gold in Codex's state.js against BRIEF.md: a heads-up is needed, so quiet would be wrong.",
    async play(w) {
      const t = team(w, {
        gameplay: [
          {
            user: "Set the starting gold and lives from BRIEF.md in createState().",
            edits: ["src/game/state.js"],
            reply: "createState() starts with 150 gold and 20 lives, as BRIEF.md says.",
          },
        ],
        ui: [
          {
            user: "Make the shop's cost labels turn red when a tower is unaffordable.",
            edits: ["src/ui/shop.js", "src/game/state.js"],
            reply: "Cost labels turn red when you can't afford a tower. The shop felt tight at 150 gold, so I also raised the starting gold to 300 in src/game/state.js.",
          },
        ],
      });
      w.write({ "src/game/state.js": FILES["src/game/state.js"].replace("gold: 150", "gold: 300") });
      const codex = await w.title(t.gameplay);
      await w.wake(t.ui, { what: "overlap", overlaps: [{ panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId, files: ["src/game/state.js"], owns: true }] }, `src/game/state.js (owned by "${codex}")`);
      return (o) => [
        { what: "drafts a heads-up", ok: o.drafts.length > 0 },
        { what: "it's about the starting gold", ok: all(o.drafts, (x) => /gold|300|150/i.test(x.text)) },
        { what: "no session is told to talk to another", ok: o.drafts.every((x) => !RELAY.test(x.text)) },
      ];
    },
  },
  {
    name: "owner-reviews",
    run2: "pi changed Claude's main.js and input.js; the handoff draft told Claude to 'coordinate' around them instead of reviewing them.",
    async play(w) {
      const done =
        "Done: the HUD, shop and tower panel are in src/ui (hud.js, shop.js, panel.js). To hook them up I also changed src/main.js (it now calls createUi(engine, game.state) after the engine starts) and src/engine/input.js (a 'ui:click' event for clicks in the top 48 px). node --test passes.";
      const t = team(w, {
        ui: [{ user: "Build the HUD, shop and tower panel in src/ui and hook them to the engine.", edits: ["src/ui/hud.js", "src/ui/shop.js", "src/ui/panel.js", "src/main.js", "src/engine/input.js"], reply: done }],
      });
      w.write({
        "src/ui/panel.js": "export function createPanel(state) {\n  return { draw(r) { if (state.selectedTower) r.drawText(state.selectedTower.name, 760, 560); } };\n}\n",
        "src/main.js": FILES["src/main.js"].replace('import { createGame } from "./game/game.js";', 'import { createGame } from "./game/game.js";\nimport { createUi } from "./ui/hud.js";').concat("createUi(engine, game.state);\n"),
        "src/engine/input.js": FILES["src/engine/input.js"].replace('    emit("pointer:down"', '    if (y < 48) return emit("ui:click", { x, y });\n    emit("pointer:down"'),
      });
      const id = w.handoff(t.ui, t.engine, "tell the Claude session to wire src/ui into src/main.js");
      w.history("When the pi session is done, tell the Claude session to wire src/ui into src/main.js.", "Planned: when pi finishes, I'll draft that for Claude Code.");
      const engine = await w.title(t.engine);
      await w.wake(t.ui, { what: "handoff", handoff: { id, to: { panelId: t.engine.id, kind: "claude", title: engine, sessionId: t.engine.sessionId }, note: "tell the Claude session to wire src/ui into src/main.js" } }, done);
      return (o) => {
        const d = to(o, t.engine);
        return [
          { what: "drafts the handoff for Claude", ok: d.some((x) => x.attachment) },
          { what: "names pi's changes to its files", ok: all(d, (x) => /main\.js/.test(x.text) && /input\.js/.test(x.text)) },
          { what: "asks it to review them", ok: all(d, (x) => /\b(review|check|look over|keep|revert|undo)/i.test(x.text)) },
          { what: "doesn't tell it to talk to another session", ok: d.every((x) => !RELAY.test(x.text)) },
        ];
      };
    },
  },
  {
    name: "done-not-continue",
    run2: "Codex had finished; the handoff draft told it to 'continue implementing' and to 'flag mismatches to Claude'.",
    async play(w) {
      const done =
        "The engine is ready: createEngine({ canvas }) returns { on(event, fn), emit, renderer, scenes, start }. Input events: 'pointer:down' { x, y, tile: { col, row } } and 'key:down' { key }. renderer: clear(), drawCircle(x, y, r, color), drawText(text, x, y, color). scenes.push(name, scene) and scenes.pop(). src/main.js starts it.";
      const t = team(w, { engine: [{ user: "Finish the engine API the game needs: scenes on top of the loop.", edits: ["src/engine/scenes.js", "src/engine/loop.js"], reply: done }] });
      w.write({ "src/engine/scenes.js": "export function createScenes() {\n  const stack = [];\n  return { push: (name, scene) => stack.push({ name, scene }), pop: () => stack.pop(), get top() { return stack.at(-1); } };\n}\n" });
      const note = "tell the Codex session the engine is ready and to check its API against src/game";
      const id = w.handoff(t.engine, t.gameplay, note);
      w.history("When the Claude session is done, tell the Codex session the engine is ready and to check its API against src/game.", "Planned: when Claude Code finishes, I'll draft that for Codex.");
      const codex = await w.title(t.gameplay);
      await w.wake(t.engine, { what: "handoff", handoff: { id, to: { panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId }, note } }, done);
      return (o) => {
        const d = to(o, t.gameplay);
        return [
          { what: "drafts the handoff for Codex", ok: d.some((x) => x.attachment) },
          { what: "doesn't tell a finished session to continue", ok: d.every((x) => !/\b(continue|keep)\s+(implementing|building|working|going)/i.test(x.text)) },
          { what: "doesn't tell it to talk to another session", ok: d.every((x) => !RELAY.test(x.text)) },
        ];
      };
    },
  },
  {
    name: "several-events",
    run2: "(Test run 6.) Claude asked for a go-ahead while the Coordinator answered Codex, and pi asked in a dialog just after: one run got both, and answered only pi.",
    async play(w) {
      const plan =
        "Here's what happens today when the tab is hidden or loses focus mid-wave, and what I'd change.\n\n**Today**\n- requestAnimationFrame stops while the tab is hidden, but the loop keeps its last timestamp, so the first frame back gets a huge dt (clamped to 0.1 s per step, but the accumulator still runs several steps at once).\n- Enemies jump forward along the path, and a burst of projectiles resolves in one frame.\n- Losing focus without hiding (another window) changes nothing.\n\n**What I'd change** (src/main.js and src/engine/loop.js only)\n1. Pause the game on visibilitychange when the tab is hidden, through the same ui:pause event the Pause button uses.\n2. Reset the loop's clock and accumulator on resume, so the first frame back has a normal dt.\n3. Leave blur alone: pausing on every focus change is annoying when you check another window.\n4. Don't unpause automatically when the tab comes back; the player presses Pause again.\n5. A pure shouldAutoPause(state, hidden) function with tests, so the rule is covered. Pausing only applies while playing and not already paused, and never on the title, help or end screens.\n\nI'd leave the banner and audio alone since they belong to the UI session. Want me to go ahead with 1, 2, 4 and 5?";
      const t = team(w, {
        engine: [{ user: "Look at what happens when the tab is hidden mid-wave. Tell me what you'd change and ask whether to go ahead; don't change anything yet.", reply: plan }],
        ui: [{ user: "The towers can be picked with 1-4. Add that to How to play, then ask me whether to also show each key on its shop card, and stop.", edits: ["src/ui/hud.js"], reply: "" }],
      });
      // The run before: Codex's choice, answered while these two came in.
      await w.earlier(t.gameplay, { what: "turn_end" }, "Two options for a fifth enemy: 1. Boiler Runner, speeds up below half health. 2. Ironclad Crawler, armour against Gear Guns but weak to Tesla. Which one should I build?", "Codex asked you to choose between Boiler Runner and Ironclad Crawler. I suggested Boiler Runner as the simpler option, following rule 2; you can send it with one tap.");
      const questions = [{ question: "Should I also show each tower's shortcut key on its shop card?", options: ["Yes", "No"] }];
      w.ask(t.ui, questions);
      await w.wakeAll([
        { panel: t.engine, event: { what: "turn_end" }, text: plan },
        { panel: t.ui, event: { what: "question", questions }, text: questions[0].question },
      ]);
      return (o) => {
        const e = to(o, t.engine);
        const u = to(o, t.ui);
        return [
          { what: "answers Claude's go-ahead", ok: e.some((x) => x.mode === "reply") },
          { what: "says yes to Claude", ok: all(e, (x) => /\b(yes|go ahead)\b/i.test(x.text)) },
          { what: "answers pi's dialog", ok: u.some((x) => x.mode === "answer") },
        ];
      };
    },
  },
  {
    name: "handoff-covered",
    run2: "(Test runs 4-6.) Claude messaged pi about the new layout itself, mid-turn; when it finished, the planned handoff drafted the same for pi again.",
    async play(w) {
      const layout =
        "Layout change in the engine (needs UI work): the canvas is now 960 x 782. import { LAYOUT } from '../engine/renderer.js': LAYOUT.hud = {x:0,y:0,w:960,h:56}, LAYOUT.map = {x:0,y:56,w:960,h:576}, LAYOUT.shop = {x:0,y:632,w:960,h:150}. Please draw the HUD into LAYOUT.hud and the shop and tower panel into LAYOUT.shop, so nothing covers the map; clicks arrive with click.region = 'hud' | 'map' | 'shop'.";
      const done =
        "The canvas now has a HUD band above the map and a shop band below it, exported as LAYOUT from src/engine/renderer.js, with input mapped per region. I've told the UI session what it needs (the LAYOUT rectangles and click.region). Also added shake() and burst() effect helpers. node --test passes.";
      const t = team(w, {
        engine: [{ user: "Give the canvas a layout where the map is never covered: a HUD band above and a shop band below, exported as one LAYOUT object the UI can draw into.", edits: ["src/engine/renderer.js", "src/main.js", "index.html"], reply: done }],
      });
      const note = "tell the pi session the new layout is ready and to move the HUD, shop and tower panel into it so nothing covers the map";
      const id = w.handoff(t.engine, t.ui, note);
      w.history("When the Claude session is done, tell the pi session the new layout is ready and to move the HUD, shop and tower panel into it so nothing covers the map.", "Planned: when Claude Code finishes, I'll draft that for pi.");
      await w.agentMessage(t.engine, t.ui, layout);
      const pi = await w.title(t.ui);
      await w.wake(t.engine, { what: "handoff", handoff: { id, to: { panelId: t.ui.id, kind: "pi", title: pi, sessionId: t.ui.sessionId }, note } }, done);
      return (o) => [
        { what: "drafts nothing new for pi", ok: to(o, t.ui).length === 0 },
        { what: "the handoff doesn't stay waiting", ok: !handoffs.pending(w.coordinator.id).some((h) => h.id === id) },
      ];
    },
  },
  {
    name: "covered-pair",
    run2: "(Test run 8.) Claude messaged pi the new layout itself; then both of its handoffs (pi and Codex) fired in one run, and the Coordinator drafted pi's again.",
    async play(w) {
      const layout =
        "Engine phase 2: the canvas is now 960 x 728, with a HUD band above the map and a shop band below it. Import LAYOUT from ../engine/renderer.js: { hud: {x:0,y:0,w:960,h:56}, map: {x:0,y:56,w:960,h:576}, shop: {x:0,y:632,w:960,h:96} }. Draw the HUD in LAYOUT.hud and the shop and tower panel in LAYOUT.shop; clicks carry zone = 'hud' | 'map' | 'shop'.";
      const done =
        "The canvas is now 960 x 728: a HUD band, the map, and a shop band, exported as LAYOUT from src/engine/renderer.js. I drafted the UI session a message with the LAYOUT rectangles and click zones. New effect helpers in src/engine/fx.js: createShake() and createParticles(), or emit fx:burst {x, y} and fx:shake {magnitude, duration} from game code. node --test passes.";
      const t = team(w, {
        engine: [{ user: "Phase 2: a layout where nothing covers the map (HUD band above, shop band below), plus screen-shake and particle helpers the game can use.", edits: ["src/engine/renderer.js", "src/engine/fx.js", "src/main.js", "index.html"], reply: done }],
      });
      const toUi = "tell the pi session the new layout is ready and to move the HUD, shop and tower panel into it so nothing covers the map";
      const toGame = "tell the Codex session which effect helpers it added (screen shake, particles) so it can use them for hits and explosions";
      const ui = w.handoff(t.engine, t.ui, toUi);
      const game = w.handoff(t.engine, t.gameplay, toGame);
      w.history("Phase 2 is starting. Please plan these handoffs: (1) when the Claude session is done, tell the pi session the new layout is ready and to move the HUD, shop and tower panel into it so nothing covers the map; (2) when the Claude session is done, tell the Codex session which effect helpers it added so it can use them for hits and explosions.", "Planned both handoffs.");
      await w.agentMessage(t.engine, t.ui, layout);
      const [pi, codex] = await Promise.all([w.title(t.ui), w.title(t.gameplay)]);
      await w.wakeAll([
        { panel: t.engine, event: { what: "handoff", handoff: { id: ui, to: { panelId: t.ui.id, kind: "pi", title: pi, sessionId: t.ui.sessionId }, note: toUi } }, text: done },
        { panel: t.engine, event: { what: "handoff", handoff: { id: game, to: { panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId }, note: toGame } }, text: done },
      ]);
      return (o) => [
        { what: "drafts nothing new for pi", ok: to(o, t.ui).length === 0 },
        { what: "pi's handoff doesn't stay waiting", ok: !handoffs.pending(w.coordinator.id).some((h) => h.id === ui) },
        { what: "drafts Codex's handoff", ok: to(o, t.gameplay).some((x) => x.attachment) },
      ];
    },
  },
  {
    name: "overlap-while-working",
    run2: "(Test run 8.) pi added a field to Codex's src/game/state.js while Codex was still adding its own, as the user asked both; the Coordinator called it compatible and drafted pi a 'review it after Codex' note anyway.",
    async play(w) {
      const t = team(w, {
        gameplay: [{ user: "Phase 3: the Boss splits into 3 Swarms when it dies; keep any new state as a small additive field in src/game/state.js.", edits: ["src/game/state.js", "src/game/enemies.js"], reply: "" }],
        ui: [
          {
            user: "Phase 3: show a 2-second 'Wave n' banner when a wave starts; add a waveBannerTimer field to createState() in src/game/state.js for it.",
            edits: ["src/game/state.js", "src/ui/hud.js"],
            reply: "Added waveBannerTimer: 0 to createState() in src/game/state.js and the banner in hud.js. Codex is editing state.js too; I only added my field.",
          },
        ],
      });
      w.write({ "src/game/state.js": "export function createState() {\n  return { gold: 150, lives: 20, wave: 0, splitQueue: [], waveBannerTimer: 0 };\n}\n" });
      const codex = await w.title(t.gameplay);
      await w.wake(t.ui, { what: "overlap", overlaps: [{ panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId, files: ["src/game/state.js"], owns: true }] }, `src/game/state.js (owned by "${codex}")`);
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.filter((d) => !d.fromAgent).length === 0 },
        { what: "stays quiet", ok: o.quiet },
      ];
    },
  },
  {
    name: "overlap-shared-test",
    run2: "(Test run 8.) Claude updated a shared test's coordinates for its new layout after Codex had added a case to it; the Coordinator said both were compatible, then drafted Claude a 'preserve Codex's assertions' note.",
    async play(w) {
      const t = team(w, {
        gameplay: [{ user: "Add an integration test that places a tower and starts wave 1.", edits: ["tests/gameplay-integration.test.js", "src/game/game.js"], reply: "Added tests/gameplay-integration.test.js: places a Gear Gun and starts wave 1. node --test passes." }],
        engine: [
          {
            user: "Phase 2: a HUD band above the map and a shop band below it, so nothing covers the map.",
            edits: ["src/engine/renderer.js", "src/main.js", "tests/gameplay-integration.test.js"],
            reply: "The map now sits between a HUD band and a shop band. In tests/gameplay-integration.test.js I only changed the canvas height and the tile click's y to the new layout; Codex's assertions are as they were. node --test passes.",
          },
        ],
      });
      const codex = await w.title(t.gameplay);
      await w.wake(t.engine, { what: "overlap", overlaps: [{ panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId, files: ["tests/gameplay-integration.test.js"], owns: false }] }, `tests/gameplay-integration.test.js (also changed by "${codex}")`);
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.filter((d) => !d.fromAgent).length === 0 },
        { what: "stays quiet", ok: o.quiet },
      ];
    },
  },
  {
    name: "handoff-already-done",
    run2: "(Test runs 7 and 8.) Claude had already wired src/game into src/main.js on its own; when Codex finished, the handoff still told Claude to wire it, which cost a turn.",
    async play(w) {
      const t = team(w, {
        engine: [
          {
            user: "pi has finished src/ui. Please wire src/ui into src/main.js.",
            edits: ["src/main.js"],
            reply: "src/ui is wired into src/main.js, and so is src/game: its modules were already there, so main.js now imports all seven, runs their update(state, dt) in order and calls setEventEmitter(emit) at boot. A headless smoke test of start, place a tower and wave 1 passes.",
          },
        ],
        gameplay: [{ user: "Finish src/game to the brief.", edits: ["src/game/game.js", "src/game/towers.js"], reply: "src/game is done: every module exports update(state, dt), drawable ones render(ctx, state); setEventEmitter(emit) wires events. node --test passes." }],
      });
      w.write({ "src/main.js": 'import * as state from "./game/state.js";\nimport * as waves from "./game/waves.js";\nimport * as towers from "./game/towers.js";\nimport * as ui from "./ui/index.js";\n// update order: waves, towers, projectiles, enemies\nstate.setEventEmitter?.(emit);\n' });
      const note = "tell the Claude session to wire src/game into src/main.js";
      const id = w.handoff(t.gameplay, t.engine, note);
      w.history("When the Codex session is done, tell the Claude session to wire src/game into src/main.js.", "Planned: when Codex finishes, I'll draft that for Claude.");
      const claude = await w.title(t.engine);
      await w.wake(t.gameplay, { what: "handoff", handoff: { id, to: { panelId: t.engine.id, kind: "claude", title: claude, sessionId: t.engine.sessionId }, note } }, "src/game is done: every module exports update(state, dt), drawable ones render(ctx, state); setEventEmitter(emit) wires events. node --test passes.");
      return (o) => [
        { what: "doesn't tell Claude to wire it again", ok: to(o, t.engine).every((x) => !/\bwire\b/i.test(x.text) || /already/i.test(x.text)) },
        { what: "the handoff doesn't stay waiting", ok: !handoffs.pending(w.coordinator.id).some((h) => h.id === id) },
      ];
    },
  },
  {
    name: "note-for-later",
    run2: "(Dialog check, ADR 0027.) The user told the Coordinator how to answer pi's question when it came; it drafted that note to pi as a message straight away.",
    async play(w) {
      const t = team(w, { ui: [{ user: "Build the title screen. Ask me what to call the game with your question tool when you get to the title, then wait.", edits: ["src/ui/title.js"], reply: "" }] });
      w.say("When the UI session asks what to call the game, answer exactly: Brassworks Defense (not one of its options).");
      await idle();
      const early = w.outcome().drafts.filter((d) => !d.fromAgent).length;
      const questions = [{ question: "What should the game be called?", options: ["Gearworks", "Cogsworth"] }];
      w.ask(t.ui, questions);
      await w.wake(t.ui, { what: "question", questions }, questions[0].question);
      return (o) => {
        const u = to(o, t.ui);
        return [
          { what: "drafts nothing when told", ok: early === 0 },
          { what: "no message to pi", ok: u.every((x) => x.mode !== "message") },
          { what: "answers the question with the name", ok: u.some((x) => x.mode === "answer") && all(u.filter((x) => x.mode === "answer"), (x) => /^brassworks defense\.?$/i.test(x.text.trim())) },
        ];
      };
    },
  },
  {
    name: "finding-routes",
    run2: "(Test runs 4 and 7.) Claude found a problem in pi's files and said so in its reply, without telling pi: nothing woke anyone (ADR 0029 wakes the Coordinator now).",
    async play(w) {
      const done =
        "Wired the HUD into src/main.js, and node --test passes. One thing for the UI: hud.js's nextWaveText names enemies from its own NAMES map, which has no beetle, so wave 4's preview reads \"undefined ×4\".";
      const t = team(w, {
        gameplay: [{ user: "Add an armoured Beetle for waves 4 and up.", edits: ["src/game/enemies.js", "src/game/waves.js"], reply: "Added the Beetle (armour 2) to ENEMIES and to waves 4 and up." }],
        engine: [{ user: "Wire the HUD's next-wave preview into the game loop.", edits: ["src/main.js"], reply: done }],
      });
      w.write({ "src/game/enemies.js": FILES["src/game/enemies.js"].replace("  boss:", '  beetle: { name: "Beetle", health: 60, speed: 40, gold: 6, armour: 2 },\n  boss:') });
      const pi = await w.title(t.ui);
      await w.wake(t.engine, { what: "finding", findings: [{ panelId: t.ui.id, kind: "pi", title: pi, sessionId: t.ui.sessionId, files: ["src/ui/hud.js"] }] }, done);
      return (o) => {
        const u = to(o, t.ui);
        return [
          { what: "drafts a message for pi", ok: u.length === 1 && u[0].mode === "message" },
          { what: "it names the Beetle and hud.js", ok: all(u, (x) => /beetle/i.test(x.text) && /hud|NAMES|nextWaveText/i.test(x.text)) },
          { what: "nothing for the others", ok: to(o, t.engine).length === 0 && to(o, t.gameplay).length === 0 },
          { what: "doesn't tell pi to talk to another session", ok: u.every((x) => !RELAY.test(x.text)) },
        ];
      };
    },
  },
  {
    name: "finding-harmless",
    run2: "(ADR 0029.) A reply names pi's file next to \"should\" and \"still\", but only to say it works: the rule wakes the Coordinator, which should stay quiet.",
    async play(w) {
      const done =
        "Wired the HUD into src/main.js, and node --test passes. I checked src/ui/hud.js: nextWaveText still reads describeWave, which works with the new waves, so nothing should change there.";
      const t = team(w, { engine: [{ user: "Wire the HUD's next-wave preview into the game loop.", edits: ["src/main.js"], reply: done }] });
      const pi = await w.title(t.ui);
      await w.wake(t.engine, { what: "finding", findings: [{ panelId: t.ui.id, kind: "pi", title: pi, sessionId: t.ui.sessionId, files: ["src/ui/hud.js"] }] }, done);
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.filter((d) => !d.fromAgent).length === 0 },
        { what: "stays quiet", ok: o.quiet },
      ];
    },
  },
  {
    name: "contract-rename",
    run2: "(Test runs 9 and 10.) Codex renamed a field the UI reads and only said so in its reply; the UI broke silently. The decision model now hears such a change as a finding.",
    async play(w) {
      const done = "Renamed describeWave's entries from { type, count } to { kind, count }, to match ENEMIES' keys. Updated tests/waves.test.js; node --test passes.";
      const t = team(w, { gameplay: [{ user: "In describeWave, call the enemy key kind rather than type, to match ENEMIES.", edits: ["src/game/waves.js"], reply: done }] });
      w.write({ "src/game/waves.js": FILES["src/game/waves.js"].replace("({ type, count })", "({ kind: type, count })") });
      await w.wake(t.gameplay, { what: "finding", findings: [] }, done);
      return (o) => {
        const u = to(o, t.ui);
        return [
          { what: "drafts a message for pi", ok: u.length === 1 },
          { what: "it names kind and hud.js", ok: all(u, (x) => /\bkind\b/.test(x.text) && /hud|nextWaveText/i.test(x.text)) },
          { what: "nothing for Claude", ok: to(o, t.engine).length === 0 },
        ];
      };
    },
  },
  {
    name: "finding-unlisted",
    run2: "(Test run 10.) Claude's reply named a file of Codex's next to work that was pi's; the event listed only Codex, and the Coordinator found nothing for Codex and stayed quiet.",
    async play(w) {
      const done =
        "Wired the waves into the game loop, node --test passes. One gap: describeWave in src/game/waves.js already lists the boss in wave 10, but nothing shows it: the HUD's next-wave preview should name the Boss when it's coming.";
      const t = team(w, { engine: [{ user: "Wire the waves into the game loop.", edits: ["src/main.js"], reply: done }] });
      const codex = await w.title(t.gameplay);
      await w.wake(t.engine, { what: "finding", findings: [{ panelId: t.gameplay.id, kind: "codex", title: codex, sessionId: t.gameplay.sessionId, files: ["src/game/waves.js"] }] }, done);
      return (o) => {
        const u = to(o, t.ui);
        return [
          { what: "drafts a message for pi", ok: u.length === 1 },
          { what: "it's about the Boss in the preview", ok: all(u, (x) => /boss/i.test(x.text)) },
          { what: "nothing for Codex", ok: to(o, t.gameplay).length === 0 },
        ];
      };
    },
  },
  {
    name: "own-draft-sent",
    run2: "(Test run 10.) Claude ended 'I drafted a message to the views session... please send it, or tell it yourself'; the user had sent it, and the Coordinator drafted the same again.",
    async play(w) {
      const layout = "The HUD band is now LAYOUT.hud ({x:0,y:0,w:960,h:56}) in src/engine/renderer.js: please draw the HUD there so it no longer covers the map.";
      const done = "The HUD band is in, node --test passes. Open issue: src/ui/hud.js still draws at y = 0 over the map. I drafted a message to the UI session about it, but it has not been sent. Please send it, or tell the UI session yourself.";
      const t = team(w, { engine: [{ user: "Give the HUD its own band above the map.", edits: ["src/engine/renderer.js", "src/main.js"], reply: done }] });
      await w.agentMessage(t.engine, t.ui, layout);
      await w.wake(t.engine, { what: "turn_end" }, done);
      return (o) => [{ what: "drafts nothing new for pi", ok: to(o, t.ui).length === 0 }];
    },
  },
  {
    name: "ownership-breach",
    run2: "(Test run 10.) Codex changed Claude's src/main.js and added a file in Claude's src/engine; the Coordinator said Claude had added it and told Codex to keep integrating there.",
    async play(w) {
      const t = team(w, {
        gameplay: [{ user: "Make waves start by themselves 20 seconds after the last one is cleared.", edits: ["src/game/waves.js", "src/main.js", "src/engine/scheduler.js"], reply: "" }],
      });
      w.write({
        "src/engine/scheduler.js": "export function startScheduler(game) {\n  setInterval(() => game.tick?.(), 1000);\n}\n",
        "src/main.js": FILES["src/main.js"].concat('import { startScheduler } from "./engine/scheduler.js";\nstartScheduler(game);\n'),
      });
      const claude = await w.title(t.engine);
      await w.wake(t.gameplay, { what: "overlap", overlaps: [{ panelId: t.engine.id, kind: "claude", title: claude, sessionId: t.engine.sessionId, files: ["src/main.js", "src/engine/scheduler.js"], owns: true }] }, `src/main.js, src/engine/scheduler.js (owned by "${claude}")`);
      return (o) => {
        const g = to(o, t.gameplay);
        return [
          { what: "drafts Codex a heads-up", ok: g.length === 1 },
          { what: "tells it to leave Claude's files", ok: all(g, (x) => /\b(leave|move|revert|undo|remove|out of|back out|don'?t (change|edit|touch))\b/i.test(x.text)) },
          { what: "doesn't say Claude made Codex's changes", ok: g.every((x) => !/claude (added|created|wrote) [^.]*scheduler/i.test(x.text)) },
        ];
      };
    },
  },
  {
    name: "permission-deny",
    run2: "(Test run 7.) Codex waited minutes on an approval in its panel nobody saw. Here it wants to install a package, which rule 4 forbids.",
    async play(w) {
      const t = team(w, {
        gameplay: [{ user: "Add a seeded random generator for wave spawns, so a run can be replayed.", edits: ["src/game/waves.js"], reply: "" }],
      });
      await w.wake(t.gameplay, { what: "permission" }, "Run: npm install seedrandom\nIts reason: Install seedrandom so wave spawns can use a seeded generator?");
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.filter((d) => !d.fromAgent).length === 0 },
        { what: "tells the user", ok: !o.quiet && o.reply.length > 0 },
        { what: "says not to allow it", ok: /\b(don['’]?t|do not|deny|decline|no\b|not allow|shouldn['’]?t|against)/i.test(o.reply) },
        { what: "names the rule (no dependencies)", ok: /dependenc|rule 4|package/i.test(o.reply) },
      ];
    },
  },
  {
    name: "permission-allow",
    run2: "(Test run 7.) A permission the rules allow: Claude asks to run the tests (rule 6 says yes).",
    async play(w) {
      const t = team(w, {
        engine: [{ user: "Add a pause on hidden tabs, and run the tests when you're done.", edits: ["src/main.js"], reply: "" }],
      });
      await w.wake(t.engine, { what: "permission" }, "Use Bash: node --test (Run the test suite)");
      return (o) => [
        { what: "drafts nothing", ok: o.drafts.filter((d) => !d.fromAgent).length === 0 },
        { what: "tells the user", ok: !o.quiet && o.reply.length > 0 },
        { what: "says to allow it", ok: /\b(allow|approve|yes|fine|ok(ay)?|go ahead|safe)\b/i.test(o.reply) && !/\b(deny|don['’]?t allow|do not allow)\b/i.test(o.reply) },
      ];
    },
  },
];
