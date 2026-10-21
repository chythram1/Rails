// The situations the check replays: the ones the Coordinator got wrong in test run 2 (.test-runs/gearworks-2),
// plus two it got right (routing, a real clash) so a fix can't trade one mistake for another. Each sets up a
// World, wakes the Coordinator the way Rails would, and returns the checks for what it did.
import type { Panel } from "@rails/shared";
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

const to = (o: Outcome, p: Panel) => o.drafts.filter((d) => d.to === p.id);
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
];
