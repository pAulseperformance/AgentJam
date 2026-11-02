#!/usr/bin/env node
/**
 * THE STYLE PROBE: does a style row actually SOUND different from another row?
 *
 * The registry made a style a row of numbers, and numbers can be wrong in the one way a listener cannot
 * forgive: two rows that measure the same are a rename with a nicer label. This measures each row from
 * a live room, one room per style, and prints the three readings that separate an idiom from a label:
 *
 *   notes/bar   how many onsets the style puts in a bar
 *   on grid     the share of onsets within 25 ms of a sixteenth, which is what "in time" means
 *   velocity    the median velocity, which is what "soft" or "loud" means
 *   spread      distinct pitches per bar, which is what "melodic" or "percussive" means
 *
 *   node tools/style-probe.mjs
 *   node tools/style-probe.mjs --styles jazz,funk,latin --seconds 25 --url wss://zpe.vc/jam
 *
 * Exit: 0 every pair differs, 1 two rows measured the same (a rename), 2 bad usage or no notes.
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const base = arg('url', 'wss://zpe.vc/jam');
// FORTY FIVE SECONDS, because a style's first bar is not its character: a model call takes seconds, and
// a fourteen second window measured one note a bar for a row that plays three to five.
const seconds = Number(arg('seconds', '45'));
// The list is written out rather than imported from the registry: this is a .mjs script and the registry
// is TypeScript, so an import here runs under a loader the gate does not have. The registry's own suite is
// what keeps the two in step, and a style missing from this list is a style the palette ships unmeasured.
const DEFAULT_STYLES = 'jazz,funk,ambient,latin,afrobeat,house,lofi,cinematic';
const styles = arg('styles', DEFAULT_STYLES).split(',');
const bpm = Number(arg('bpm', '110'));

if (!/^wss?:\/\//.test(base)) {
  console.error(`style-probe: --url must be a ws:// or wss:// host, got ${base}`);
  process.exit(2);
}

/** One room, one agent, and the notes the ROOM publishes back, which is what a listener hears. */
async function probeStyle(style) {
  const room = `style-${style}-${randomUUID().slice(0, 6)}`;
  const url = `${base}/api/room/${room}/ws`;
  const notes = [];
  let agentPeerId = null;
  let roomBpm = null;
  let spawned = false;
  let bars = 0;
  const seenTypes = new Map();
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = () => {
      try { ws.close(); } catch { /* already closing */ }
      if (process.argv.includes('--verbose')) console.error(`${style}: agent=${String(agentPeerId).slice(0,8)} peers=${JSON.stringify(Object.entries(notes.reduce((a,n)=>{const k=String(n.peerId).slice(0,8);a[k]=(a[k]||0)+1;return a;},{})))}`);
      resolve({ style, room, notes, agentPeerId, bars, roomBpm });
    };
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_room', name: 'Probe', kind: 'human', instrument: 'electric-piano' }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type === 'room_state' && typeof msg.roomState?.bpm === 'number') {
        // THE TEMPO THE ROOM ACTUALLY PLAYS, read back rather than assumed: a refused change would have
        // shifted every reading by the ratio, and a note count per bar is meaningless against the wrong
        // bar length.
        roomBpm = msg.roomState.bpm;
      }
      if (msg.type === 'room_state' && !spawned) {
        // ONCE. The room re-broadcasts room_state on every setting change, so an unguarded spawn here
        // asked for an agent on each frame and hit the room's agent limit on the second one, which is
        // why three of four styles measured zero notes.
        spawned = true;
        ws.send(JSON.stringify({ type: 'bpm_change', bpm }));
        ws.send(JSON.stringify({ type: 'spawn_agent', name: `Probe ${style}`, style }));
        // NO SECTION BY DEFAULT. A style is the agent's own line, and with the drummer and bass in the
        // room the agent's notes arrived under neither peer id the probe saw, so the reading was of the
        // rhythm section. --backing puts them back for anyone measuring the whole band.
        if (process.argv.includes('--backing')) {
          ws.send(JSON.stringify({ type: 'set_backing', drummer: true, bass: true }));
        }
      }
      // THE EXACT NAME, not a prefix: the room names its backing layers after the first agent, so
      // "Probe funk" and "Probe funk drummer" both start with "Probe" and the prefix match captured the
      // layer's id, which plays nothing of its own and made every style measure zero notes.
      if (msg.type === 'agent_spawned' && msg.peer?.name === `Probe ${style}`) {
        agentPeerId = msg.peer.peerId;
      }
      if (msg.type === 'note_on' && typeof msg.pitch === 'string') {
        // ONLY THE AGENT'S OWN LINE. Counting the drummer and the bass as well made every style read as
        // the rhythm section plus a melody, which is why funk measured 28 notes a bar for a row that asks
        // for three to five.
        notes.push({ t: Date.now(), pitch: msg.pitch, velocity: Number(msg.velocity) || 0, peerId: msg.peerId });
      }
      if (msg.type === 'ai_debug') bars += 1;
      seenTypes.set(msg.type, (seenTypes.get(msg.type) ?? 0) + 1);
    });
    setTimeout(done, seconds * 1000);
  });
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const barMsFor = (tempo) => 240_000 / Math.max(20, tempo);
const results = [];
for (const style of styles) {
  const reading = await probeStyle(style);
  // THE AGENT'S OWN LINE, filtered once its id is known. Notes that arrived before the spawn frame are
  // kept and then dropped here rather than lost, because a probe that discards the first bars measures
  // the style's opening badly for exactly the styles that start slow.
  const notes = reading.agentPeerId
    ? reading.notes.filter(note => note.peerId === reading.agentPeerId)
    : reading.notes;
  if (notes.length === 0) {
    results.push({ style, notes: 0, perBar: 0, onGrid: 0, velocity: 0, spread: 0 });
    continue;
  }
  const first = notes[0].t;
  const last = notes[notes.length - 1].t;
  // The room's own tempo when it answered one, the requested tempo otherwise.
  const barMs = barMsFor(reading.roomBpm ?? bpm);
  const spanBars = Math.max(1, (last - first) / barMs);
  // THE GRID IS ESTIMATED, not assumed: the first note is not a bar line, so the phase that aligns the
  // largest share of onsets is found first and the share near THAT phase is what is reported.
  const slot = barMs / 4;
  const bins = 16;
  const histogram = new Array(bins).fill(0);
  for (const note of notes) histogram[Math.floor((((note.t - first) % slot) / slot) * bins) % bins] += 1;
  const peakBin = histogram.indexOf(Math.max(...histogram));
  const offset = ((peakBin + 0.5) / bins) * slot;
  const onGrid = notes.filter(note => {
    const phase = (((note.t - first - offset) % slot) + slot) % slot;
    return Math.min(phase, slot - phase) < 25;
  }).length / notes.length;
  const pitchSpread = new Set(notes.map(note => note.pitch)).size / Math.max(1, spanBars);
  results.push({
    style,
    notes: notes.length,
    perBar: Number((notes.length / spanBars).toFixed(2)),
    onGrid: Number(onGrid.toFixed(2)),
    velocity: median(notes.map(note => note.velocity)),
    spread: Number(pitchSpread.toFixed(2)),
    tempo: reading.roomBpm,
  });
}

const head = 'style      notes/bar  on grid  velocity  pitches/bar';
console.log(head);
console.log('-'.repeat(head.length));
for (const row of results) {
  console.log(
    `${row.style.padEnd(10)} ${String(row.perBar).padEnd(10)} ${String(row.onGrid).padEnd(8)} ${String(row.velocity).padEnd(9)} ${row.spread}${row.tempo ? `   (${row.tempo} bpm)` : ''}`,
  );
}

const signature = (row) => `${row.perBar}|${row.onGrid}|${row.velocity}|${row.spread}`;
const clashes = [];
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    if (results[i].notes > 0 && signature(results[i]) === signature(results[j])) {
      clashes.push(`${results[i].style} and ${results[j].style} measure identically (${signature(results[i])})`);
    }
  }
}

const empty = results.filter(row => row.notes === 0).map(row => row.style);
if (empty.length) {
  console.log(`\nRESULT: no notes from ${empty.join(', ')}, so those rows are unproven rather than different.`);
  process.exit(2);
}
if (clashes.length) {
  console.log('\nRESULT: two rows are the same sound by these readings, which makes one a rename:');
  for (const clash of clashes) console.log(`  ${clash}`);
  process.exit(1);
}
console.log('\nRESULT: every pair of styles differs in at least one reading.');
process.exit(0);
