#!/usr/bin/env node
/**
 * BROWSER SMOKE — the live page, not a WebSocket client.
 *
 * `tools/probe-session.mjs` already joins the room with `ws`, so it can say what the ROOM publishes.
 * It cannot say what a LISTENER'S PAGE does with it, and the page is the half that opened a second
 * socket per tab once (~18 copies of every broadcast arrived on one tab, each one joining as its own
 * peer). So this script loads the live page in headless Chromium, joins it, spawns ONE agent, and
 * takes its readings from Playwright's own view of the page's sockets:
 *
 *   sockets      how many WebSockets the page constructed. One tab is one socket; a count of two is
 *                the duplicate-socket defect, whatever the page draws.
 *   join / spawn the join_room and spawn_agent frames the page SENT. One each: the page joined as
 *                itself, and the model bar below belongs to the one agent this run asked for rather
 *                than to a neighbour already in the room.
 *   model bars   ai_debug frames the page RECEIVED whose meta.source is 'llm' — the same counting
 *                rule tools/probe-session.mjs and scripts/probe-gate.mjs use. Anything else the
 *                room may write (rest, pattern, cell, fallback, late) is printed but not counted.
 *
 * THE DEADLINE IS TWELVE SECONDS from navigation, covering the load, the join, the spawn and the
 * first model bar. At 120 BPM the room's bar is two seconds and the first render starts at spawn,
 * so a page that reaches a model bar at all reaches it well inside that; a run needing longer is
 * measuring a different page than a listener opens.
 *
 * THE ROOM IS NEW BY DEFAULT (`smoke-<8 hex>`): a run must not inherit agents a previous listener
 * left behind, or a model bar could be counted that this run's one spawn never wrote. `--room`
 * joins a named one instead.
 *
 *   node tools/browser-smoke.mjs
 *   node tools/browser-smoke.mjs --url https://zpe.vc/jam/ --deadline 15000
 *
 * ONE TIME, the dependency this reading costs (a dev dependency only):
 *   npm i -D playwright && npx playwright install chromium
 *
 * Exit: 0 all readings made and held; 1 a reading failed (the FAIL line names which); 2 bad usage;
 * 3 playwright or its chromium is not installed — a reading that could not run, which check.sh
 * counts as not asserted and never as a pass.
 */
import { randomBytes } from 'node:crypto';

const DEFAULT_URL = 'https://zpe.vc/jam/';
const DEFAULT_DEADLINE_MS = 12000;
const DEADLINE_FLOOR_MS = 2000;

function synopsis(out) {
  out('usage: node tools/browser-smoke.mjs [--url <page>] [--room <id>] [--deadline <ms>] [--headful]');
  out('  loads the live page, joins it, spawns one agent, and asserts one socket');
  out('  and one model bar inside the deadline (default 12000 ms)');
}
function usage(why) {
  if (why) console.error(`browser-smoke: ${why}`);
  synopsis(console.error);
  process.exit(2);
}

let rawUrl = DEFAULT_URL;
let roomArg = '';
let deadlineMs = DEFAULT_DEADLINE_MS;
let headful = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--url') { rawUrl = argv[++i] ?? ''; continue; }
  if (a === '--room') { roomArg = argv[++i] ?? ''; continue; }
  if (a === '--deadline') { deadlineMs = Number(argv[++i]); continue; }
  if (a === '--headful') { headful = true; continue; }
  if (a === '-h' || a === '--help') { synopsis(console.log); process.exit(0); }
  usage(`unknown argument ${a}`);
}

let pageUrl;
try { pageUrl = new URL(rawUrl); } catch { usage(`--url is not a URL: ${rawUrl}`); }
if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
  usage(`--url must be http or https, not ${pageUrl.protocol}`);
}
if (!Number.isInteger(deadlineMs) || deadlineMs < DEADLINE_FLOOR_MS) {
  usage(`--deadline takes whole milliseconds of at least ${DEADLINE_FLOOR_MS}, not "${deadlineMs}"`);
}
const room = roomArg || `smoke-${randomBytes(4).toString('hex')}`;
if (!/^[A-Za-z0-9_-]{1,64}$/.test(room)) {
  usage(`--room takes a plain id (letters, digits, dash, underscore), not "${room}"`);
}

// THE DEPENDENCY IS OPTIONAL AT THE EDGE. A machine that never installed Playwright has a reading it
// cannot make, not a broken page, so that exits 3 and check.sh prints "not asserted".
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (err) {
  console.error(`browser-smoke: playwright is not installed (${String(err.message).split('\n')[0]})`);
  console.error('  install once: npm i -D playwright && npx playwright install chromium');
  process.exit(3);
}

let browser;
try {
  browser = await chromium.launch({ headless: !headful, timeout: 15000 });
} catch (err) {
  console.error(`browser-smoke: chromium did not start (${String(err.message).split('\n')[0]})`);
  console.error('  install once: npx playwright install chromium');
  process.exit(3);
}

const sockets = [];
const sent = new Map();          // frame type -> count, from the page to the room
const received = new Map();      // frame type -> count, from the room to the page
const sources = new Map();       // ai_debug meta.source -> count
const llmBars = [];              // the model bars, with the page-clock time they arrived
const joins = [];                // join_room frames the page sent
const spawns = [];               // spawn_agent frames the page sent
const spawnedPeers = [];         // agent_spawned names the page received
const pageErrors = [];
let loadStartedAt = Date.now();  // reset to just before goto: page time starts at navigation
const marks = {};
function mark(name) { marks[name] = ((Date.now() - loadStartedAt) / 1000).toFixed(1); }

function count(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }

/** A text frame that is a JSON object, or null. The room speaks text frames only. */
function jsonFrame(frame) {
  const payload = frame.payload;
  if (typeof payload !== 'string' || payload.charCodeAt(0) !== 0x7b) return null; // '{'
  try { return JSON.parse(payload); } catch { return null; }
}

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(deadlineMs);
page.on('pageerror', (err) => pageErrors.push(String(err.message).split('\n')[0]));

// PLAYWRIGHT COUNTS THE SOCKETS ITSELF, from outside the page: the count does not depend on a wrapper
// this script installs, so a page that swaps `window.WebSocket` cannot hide a second socket from it.
page.on('websocket', (ws) => {
  const row = { url: ws.url(), at: Date.now() - loadStartedAt, state: 'open', in: 0, out: 0 };
  sockets.push(row);
  ws.on('framesent', (frame) => {
    row.out++;
    const msg = jsonFrame(frame);
    if (!msg) return;
    const type = String(msg.type ?? 'unknown');
    count(sent, type);
    if (type === 'join_room') {
      joins.push({ name: String(msg.name ?? ''), at: Date.now() - loadStartedAt });
    }
    if (type === 'spawn_agent') {
      spawns.push({ name: String(msg.name ?? ''), style: String(msg.style ?? ''), at: Date.now() - loadStartedAt });
    }
  });
  ws.on('framereceived', (frame) => {
    row.in++;
    const msg = jsonFrame(frame);
    if (!msg) return;
    const type = String(msg.type ?? 'unknown');
    count(received, type);
    if (type === 'agent_spawned') spawnedPeers.push(String(msg.peer?.name ?? ''));
    if (type === 'ai_debug') {
      const source = String(msg.meta?.source ?? 'unknown');
      count(sources, source);
      if (source === 'llm') {
        llmBars.push({ agent: String(msg.agentName ?? ''), bar: msg.bar ?? null, at: Date.now() - loadStartedAt });
      }
    }
  });
  ws.on('close', () => { row.state = 'closed'; });
});

/** Wait for a reading, up to `ms`; true when it is there. */
async function until(reading, ms) {
  const endsAt = Date.now() + Math.max(0, ms);
  while (Date.now() < endsAt) {
    if (reading()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return reading();
}

/** Time left on the twelve-second budget, in ms, never zero (a last click still gets a chance). */
function remaining() {
  return Math.max(400, loadStartedAt + deadlineMs - Date.now());
}

/** THE BUDGET ITSELF, allowed to reach zero: a wait must stop AT the deadline, not after it. */
function budget() {
  return Math.max(0, loadStartedAt + deadlineMs - Date.now());
}

let failure = null;
let overlayTakenDown = false;
/** what the "four bars per call" switch read after it was pressed (null when the press never happened) */
let toggle = null;
let toggleErrors = [];
/** what "four bars per call" read BEFORE it was pressed: absent-means-on is the room's default now */
let toggleDefault = null;
/** bright pixels on the visualizer canvas, at the bar and 1.2 s later (null when it was not read) */
let canvasAtBar = null;
let canvasLater = null;
/** the audio analyser's loudest bar, at the model bar and 1.5 s later (null when the canvas is absent) */
let meterAtBar = null;
let meterLater = null;
/** the vibe select's value before and after picking funk (null when the control is absent) */
let vibeBefore = null;
let vibeAfter = null;
/** what each dock pane painted: bright pixels plus its own data attributes */
let dockReadings = {};
try {
  loadStartedAt = Date.now();
  // COMMIT, NOT DOMContentLoaded. The estate bar's script (zpe-bar.js in the shell head) holds
  // DOMContentLoaded for about seven seconds on this page while the app itself is drawn in about one:
  // measured here, the form exists at 1.3 s and readyState reaches interactive at 8 s. Waiting for the
  // last deferred script would spend two-thirds of the budget on chrome this run does not read.
  const response = await page.goto(pageUrl.href, { waitUntil: 'commit', timeout: remaining() });
  if (!response) throw new Error(`GET ${pageUrl.href} answered nothing`);
  if (response.status() >= 400) throw new Error(`GET ${pageUrl.href} answered ${response.status()}`);
  mark('commit');
  await page.waitForSelector('#player-name', { timeout: remaining() });
  mark('form');
  await page.fill('#player-name', 'Smoke');
  await page.fill('#room-id', room);
  await page.click('#join-room', { timeout: remaining() });
  mark('submit');

  // join_room is sent on open, so a SENT frame is the page's own confirmation that it is in the room.
  if (!await until(() => joins.length >= 1, budget())) {
    throw new Error(`the page sent no join_room frame (sockets ${sockets.length}, received ${describe(received)})`);
  }
  mark('join');

  // THE AUDIO OVERLAY IS A REAL USER-GESTURE GATE and it covers the page, so click it the way a
  // listener does. If the engine cannot start under a headless audio device, take the overlay down and
  // say so rather than failing the socket reading, which is what this run is here for.
  // WAIT FOR THE BUTTON, THEN CLICK IT. A click on a selector that is not on the page yet throws and
  // was swallowed here, which left the audio context unstarted, the analyser absent and every meter
  // reading a flat zero that looked like a silent room.
  await page.waitForSelector('#start-audio', { state: 'visible', timeout: Math.min(remaining(), 4000) })
    .catch(() => {});
  await page.click('#start-audio', { timeout: Math.min(remaining(), 3000) }).catch(() => {});
  await page.waitForSelector('.jam-room__overlay', { state: 'detached', timeout: Math.min(remaining(), 2000) })
    .catch(() => {});
  if (await page.locator('.jam-room__overlay').count()) {
    await page.evaluate(() => { document.querySelector('.jam-room__overlay')?.remove(); });
    overlayTakenDown = true;
  }

  // THE ONE AGENT. The name is set so the agent_spawned frame can be tied to this click, not to a
  // neighbour that happens to be in the same room.
  await page.waitForSelector('.agent-panel__spawn-btn', { timeout: remaining() });
  await page.fill('.agent-panel__name-input', 'Smoke');
  await page.click('.agent-panel__spawn-btn', { timeout: remaining() });
  // A click lost to a re-render is retried ONCE, and only while the page has sent no spawn at all:
  // a retry after a spawn went through would be a second agent, which the count below refuses.
  if (!await until(() => spawns.length >= 1, Math.min(budget(), 2000))) {
    await page.click('.agent-panel__spawn-btn', { timeout: remaining() });
  }
  if (!await until(() => spawns.length >= 1 && spawnedPeers.includes('Smoke'), budget())) {
    throw new Error(`the one agent did not spawn: spawn_agent sent ${spawns.length}, agent_spawned received ${spawnedPeers.length}`);
  }
  mark('spawn');

  // THE READING THE PLAN ASKS FOR: a bar the MODEL wrote, arriving on the page's own socket.
  if (!await until(() => llmBars.length >= 1, budget())) {
    throw new Error(`no model bar inside ${(deadlineMs / 1000).toFixed(1)} s of load: ` +
      `ai_debug ${received.get('ai_debug') ?? 0} (${describe(sources)})`);
  }
  mark('bar');

  // AND THE PANEL'S OWN SWITCH, PRESSED. "Four bars per call" used to take the page down the moment it
  // was pressed: the handler broadcast room_state with no `peers`, the page's peer list became
  // undefined, and the next render spread it, so the listener saw "Something went wrong. Q is not
  // iterable". This run pressed nothing, so nothing in the gate could have said so. The reading is the
  // switch's own state after the round trip, plus the peer list that the defect emptied.
  // AND WHAT THE VISUALIZER PAINTS while the bar that just landed is still inside its 5 s window. A
  // grid alone never clears 90 on a channel, so bright pixels are notes: the reading exists because
  // "there should be a visualizer" is asked about a canvas that is already mounted, and the answer is
  // either that it draws or that it paints a grid and nothing else.
  const brightPixels = async () => page.evaluate(() => {
    const canvas = document.querySelector('canvas.visualizer');
    const ctx = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null;
    if (!ctx || !canvas) return null;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 90) n++;
    return n;
  });
  canvasAtBar = await brightPixels();
  await page.waitForTimeout(1200);
  canvasLater = await brightPixels();

  // AND THE ROOM'S EARS. The roll above is drawn from the event list; this canvas is fed by an
  // analyser on the master gain, so a peak above zero is the only reading that says the page can hear
  // the room. A meter that stays at zero while notes play is drawing the event stream again.
  const meterPeak = async () => page.evaluate(() => {
    // THE DEFAULT PANE IS THE SPECTRUM, and it is the only loudness reading on the page now: the
    // separate meter under the roll was removed because the Meters pane answers the same question.
    const canvas = document.querySelector('canvas.spectrum-pane');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    return { peak: Number(canvas.dataset.peak ?? '0'), armed: canvas.dataset.armed === 'yes' };
  });
  meterAtBar = await meterPeak();
  await page.waitForTimeout(1500);
  meterLater = await meterPeak();

  // AND THE VIBE CONTROL. The select shows the room's style; picking one only sticks if the server's
  // room_state came back and the page re-rendered it, so a value that holds is the frame and the render.
  vibeBefore = await page.inputValue('#vibe-select').catch(() => null);
  await page.selectOption('#vibe-select', 'funk', { timeout: Math.max(500, Math.min(remaining(), 3000)) }).catch(() => {});
  await page.waitForTimeout(700);
  vibeAfter = await page.inputValue('#vibe-select').catch(() => null);

  // AND THE DOCK: four panes, each of which must paint when it is picked. The note roll above the
  // keyboard is untouched, so this is additive and the readings below are per pane rather than one.
  dockReadings = {};
  for (const tab of ['spectrum', 'band', 'meters', 'stereo', 'atmos']) {
    await page.click(`[data-pane-tab="${tab}"]`, { timeout: Math.max(400, Math.min(remaining(), 2500)) }).catch(() => {});
    await page.waitForTimeout(900);
    dockReadings[tab] = await page.evaluate((pane) => {
      const className = {
        band: 'band-view-pane',
        spectrum: 'spectrum-pane',
        meters: 'meters-pane',
        stereo: 'stereo-pane',
        atmos: 'atmos-gl-pane',
      }[pane];
      const canvas = document.querySelector(`.${className}`);
      if (!(canvas instanceof HTMLCanvasElement)) return { drawn: null };
      // A WEBGL CANVAS CANNOT BE READ WITH getImageData, so the shader pane counts its own frames in
      // data-painted and this reading asks it, rather than sampling pixels it does not expose.
      const painted = canvas.dataset.painted;
      if (painted !== undefined) {
        return {
          drawn: Number(painted) > 0 ? Number(painted) : null,
          frames: painted,
          preset: canvas.dataset.preset ?? null,
          dock: document.querySelector('.visualizer-dock')?.getAttribute('data-pane') ?? null,
        };
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return { drawn: null };
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 70 || d[i + 1] > 70 || d[i + 2] > 70) bright++;
      return {
        drawn: bright,
        lanes: canvas.dataset.lanes ?? null,
        peak: canvas.dataset.peak ?? null,
        correlation: canvas.dataset.correlation ?? null,
        channels: canvas.dataset.channels ?? null,
        delta: canvas.dataset.delta ?? null,
        bass: canvas.dataset.bass ?? null,
        dock: document.querySelector('.visualizer-dock')?.getAttribute('data-pane') ?? null,
      };
    }, tab);
  }
  // back to the roll's neighbour so the last pane is not the one left on screen
  await page.click('[data-pane-tab="spectrum"]', { timeout: 1500 }).catch(() => {});

  // THE SWITCH STARTS ON, because a room that has never chosen is asked for phrases: a style lives in its
  // phrase. So the reading is the DEFAULT first, then the round trip off and back on, which is more than
  // the old one proved and is the reading the new default needs.
  toggleDefault = await page.evaluate(() => {
    const box = document.querySelector('#phrase-ask');
    return box instanceof HTMLInputElement ? box.checked : null;
  });
  const errorsBefore = pageErrors.length;
  await page.click('#phrase-ask', { timeout: Math.max(500, Math.min(remaining(), 4000)) });
  await page.waitForTimeout(700);
  toggle = await page.evaluate(() => {
    const box = document.querySelector('#phrase-ask');
    const host = document.querySelector('.jam-room__phrase-ask');
    return {
      checked: box instanceof HTMLInputElement ? box.checked : null,
      note: (host?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      peers: document.querySelectorAll('.peer-list__item').length,
      crashed: document.body.innerText.includes('Something went wrong'),
    };
  });
  // AND BACK ON, so a listener who presses twice is where they started.
  await page.click('#phrase-ask', { timeout: Math.max(500, Math.min(remaining(), 2000)) }).catch(() => {});
  await page.waitForTimeout(600);
  const toggleBackOn = await page.evaluate(() => {
    const box = document.querySelector('#phrase-ask');
    return box instanceof HTMLInputElement ? box.checked : null;
  });
  if (toggleBackOn !== true) {
    toggleErrors.push(`pressing twice left the switch at ${String(toggleBackOn)}`);
  }
  toggleErrors = pageErrors.slice(errorsBefore);
} catch (err) {
  failure = err.message;
}

// THE PANEL, as corroboration rather than a second assertion. The page's foot panel reads the same
// recorder these frames fed, but a PUBLIC (signed-out) listener gets the guest state and NO rows —
// `stateOf` puts `signed out` first on purpose — so the "Model bars" row is not there to read from a
// smoke run without a door cookie. What this run can say about the panel is that the page drew it, in
// the state the tier calls for; that is printed and not gated.
let panelDrawn = false;
let panelState = null;
try {
  const panel = await page.evaluate(() => {
    const section = document.querySelector('.session-panel');
    return section ? { state: section.getAttribute('data-state') } : null;
  });
  panelDrawn = panel !== null;
  panelState = panel?.state ?? null;
} catch { /* the page may have closed; the frames already carry the reading */ }

// ── The readings, printed whether they held or not ───────────────────────────
const elapsed = (Date.now() - loadStartedAt) / 1000;
function describe(map) {
  return [...map].map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
}

console.log(`url ${pageUrl.href}   room ${room}   deadline ${(deadlineMs / 1000).toFixed(1)} s`);
console.log(`timing commit ${marks.commit ?? 'n/a'} s   form ${marks.form ?? 'n/a'} s   submit ${marks.submit ?? 'n/a'} s` +
  `   join ${marks.join ?? 'n/a'} s   spawn ${marks.spawn ?? 'n/a'} s   bar ${marks.bar ?? 'n/a'} s`);
const socketLine = (row) => `${row.url} (${row.state}, ${row.in} in / ${row.out} out)`;
if (sockets.length === 0) {
  console.log('sockets 0   the page constructed no WebSocket');
} else {
  console.log(`sockets ${sockets.length}   ${socketLine(sockets[0])}`);
  for (const row of sockets.slice(1)) console.log(`        ${socketLine(row)}`);
}
console.log(`joined ${joins.length}   join_room frames sent; first at ${joins.length ? `${(joins[0].at / 1000).toFixed(1)} s` : 'n/a'}`);
console.log(`spawned ${spawns.length}   spawn_agent frames sent${spawns.length ? ` ("${spawns[0].name}", ${(spawns[0].at / 1000).toFixed(1)} s)` : ''}` +
  `; agent_spawned received ${spawnedPeers.length}`);
if (llmBars.length) {
  console.log(`model bars >= 1   ${llmBars.length} this run, first at ${(llmBars[0].at / 1000).toFixed(1)} s` +
    `   ai_debug ${received.get('ai_debug') ?? 0} (${describe(sources)})`);
} else {
  console.log(`model bars >= 1   0 this run   ai_debug ${received.get('ai_debug') ?? 0} (${describe(sources)})`);
}
console.log(panelDrawn
  ? `panel drawn, state "${panelState ?? 'unknown'}"${panelState === 'signed out' ? ' (a guest: the panel draws its guest state and no rows)' : ''}`
  : 'panel not drawn (no .session-panel on the page)');
console.log('dock       ' + Object.entries(dockReadings).map(([pane, read]) => `${pane} ${read.drawn === null ? 'NO CANVAS' : (read.frames !== undefined ? `${read.frames} frames (${read.preset})` : `${read.drawn}px`)}`).join(', '));
if (dockReadings.stereo?.correlation) console.log(`           stereo correlation ${dockReadings.stereo.correlation} over ${dockReadings.stereo.channels} channel(s), left-right delta ${dockReadings.stereo.delta} (phase 1.0 with a nonzero delta is a panned mono source, not a mono room)`);
console.log(vibeBefore === null
  ? 'vibe       no #vibe-select on the page'
  : `vibe       read ${vibeBefore}, picked funk, now reads ${vibeAfter}`);
console.log(meterAtBar
  ? `audio meter ${meterAtBar.armed ? 'armed' : 'NOT ARMED'}: peak ${meterAtBar.peak} at the bar, ` +
    `${meterLater ? meterLater.peak : 'n/a'} 1.5 s later`
  : 'audio meter not on the page (no canvas.spectrum-pane)');
console.log(`visualizer bright pixels ${canvasAtBar ?? 'n/a'} at the bar, ${canvasLater ?? 'n/a'} 1.2 s later` +
  `${canvasAtBar === null ? ' (no canvas.visualizer on the page)' : ''}`);
console.log(`toggle     default ${String(toggleDefault)} (on is the room's default when nobody has chosen)`);
console.log(toggle
  ? `toggle     "four bars per call" pressed: checked ${toggle.checked}, peers ${toggle.peers}` +
    `${toggle.crashed ? ', PAGE SAYS SOMETHING WENT WRONG' : ''}${toggleErrors.length ? `, ${toggleErrors.length} page error(s)` : ''}` +
    `\n           ${toggle.note || '(no note under the switch)'}`
  : 'toggle     not pressed (the page never reached the switch)');
if (overlayTakenDown) console.log('audio     the start-audio overlay was taken down without the engine starting');
if (pageErrors.length) console.log(`page errors ${pageErrors.length}: ${pageErrors.slice(0, 3).join(' | ')}`);

// ── The assertions ───────────────────────────────────────────────────────────
if (!failure) {
  if (sockets.length !== 1) {
    failure = `the page constructed ${sockets.length} sockets, not 1: ${sockets.map((s) => s.url).join(', ')}`;
  } else if (!sockets[0].url.includes(`/api/room/${room}/ws`)) {
    failure = `the one socket is ${sockets[0].url}, not the room route /api/room/${room}/ws`;
  } else if (joins.length !== 1) {
    failure = `the page sent ${joins.length} join_room frames, not 1`;
  } else if (spawns.length !== 1) {
    failure = `the page sent ${spawns.length} spawn_agent frames, not 1`;
  } else if (llmBars.length < 1) {
    failure = `the page received ${llmBars.length} model bars, not at least 1`;
  } else if (llmBars[0].at > deadlineMs) {
    failure = `the first model bar arrived at ${(llmBars[0].at / 1000).toFixed(1)} s of load, after the ` +
      `${(deadlineMs / 1000).toFixed(1)} s deadline`;
  } else if (!spawnedPeers.includes('Smoke')) {
    failure = `the room never announced the one agent: agent_spawned names ${spawnedPeers.join(', ') || 'nobody'}`;
  } else if (Object.keys(dockReadings).length !== 5) {
    failure = `the visualizer dock offered ${Object.keys(dockReadings).length} panes, not 5`;
  } else if (Object.values(dockReadings).some(read => read.drawn === null)) {
    failure = 'a dock pane drew no canvas when it was picked';
  } else if (Object.values(dockReadings).some(read => read.frames !== undefined ? Number(read.frames) < 3 : (read.drawn ?? 0) < 40)) {
    // A 2D pane is scored in bright pixels and the shader pane in frames drawn, because a WebGL canvas
    // cannot be read with getImageData and counting its pixels was never what the reading meant.
    failure = `a dock pane painted almost nothing: ${JSON.stringify(Object.entries(dockReadings).map(([p, r]) => [p, r.frames ?? r.drawn]))}`;
  } else if (vibeBefore === null) {
    failure = 'the room has no vibe control (#vibe-select)';
  } else if (vibeAfter !== 'funk') {
    failure = `picking a vibe left the control reading ${String(vibeAfter)}, so the room did not take it`;
  } else if (meterAtBar === null) {
    failure = 'the audio meter is not on the page (no canvas.audio-meter)';
  } else if (meterAtBar.armed && llmBars.length >= 1
    && (meterAtBar.peak === 0 && (!meterLater || meterLater.peak === 0))) {
    // THE FALSIFIER FROM THE PLAN: a meter that never leaves zero while a model bar is playing is
    // drawing something other than the audio, and it would look identical with the speakers off.
    failure = 'the audio meter is armed and read zero at the bar and 1.5 s later while the room played';
  } else if (!toggle) {
    failure = 'the "four bars per call" switch was never pressed (no #phrase-ask on the page)';
  } else if (toggleDefault !== true) {
    failure = `the phrase switch defaulted to ${String(toggleDefault)}, and a room that has never chosen asks for phrases`;
  } else if (toggle.checked !== false || !toggle.note.includes('one bar at a time')) {
    failure = `pressing "four bars per call" left the switch at checked=${String(toggle.checked)} ` +
      `with the note "${toggle.note || '(none)'}"`;
  } else if (toggle.peers < 1) {
    failure = `pressing "four bars per call" emptied the peer list (${toggle.peers} rows after the press)`;
  } else if (toggle.crashed) {
    failure = 'pressing "four bars per call" put "Something went wrong" on the page';
  } else if (toggleErrors.length) {
    failure = `pressing "four bars per call" raised a page error: ${toggleErrors[0]}`;
  }
}

if (failure) {
  console.log(`FAIL: ${failure}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
console.log(`ok: one socket, one agent, and the model wrote ${llmBars.length} bar${llmBars.length === 1 ? '' : 's'} inside ${(deadlineMs / 1000).toFixed(1)} s of load (${elapsed.toFixed(1)} s wall)`);
await browser.close().catch(() => {});
process.exit(0);
