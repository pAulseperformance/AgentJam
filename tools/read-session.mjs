#!/usr/bin/env node
/**
 * SESSION READER.
 *
 * A probe writes its whole session to a file, and a browser hands the same shape over as a download
 * (`sessionSnapshot()`, src/client/features/room/lib/session-recorder.ts). Both hold `messages`, the
 * `notes` lifted out of them, and one `bars` row per agent bar the room published. This prints the
 * same summary `tools/probe-session.mjs` prints for a live run, computed from the file instead of a
 * socket: the four numbers on the `messages` line (messages, notes, bar records, duplicate
 * (agent,ms)) and the `latency` line are the card's acceptance, and every other line the probe
 * prints is here too.
 *
 * IT IS A SECOND COPY OF `report()` IN `tools/probe-session.mjs`, deliberately: the probe owns a
 * socket and this owns a file, and the probe is a script, not a module that can be imported. The
 * rule that makes the two copies safe is agreement on the same file: when `probe-session.mjs`
 * changes a count or a format, this file changes in the same commit, and the check is a live run
 * followed by a read of its own output - every summary line must be identical.
 *
 * NO COUNT IS HARDCODED. Every number below is counted from the rows the file carries, so a file
 * from an older probe, a browser export, or a run with the settings flipped prints its own summary.
 * An empty `bars` array prints `model bars 0` however many `notes` rows sit beside it: the notes are
 * what played, the bars are what the room decided, and one cannot stand in for the other.
 *
 *   node tools/read-session.mjs /tmp/rs.json
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/read-session.mjs <session.json>');
  process.exit(2);
}

let file;
try {
  file = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`cannot read ${path}: ${err.message}`);
  process.exit(2);
}
if (!file || typeof file !== 'object' || (!Array.isArray(file.bars) && !Array.isArray(file.notes) && !Array.isArray(file.messages))) {
  console.error(`${path} is not a session file: no bars, notes or messages`);
  process.exit(2);
}

const bars = Array.isArray(file.bars) ? file.bars : [];
const notes = Array.isArray(file.notes) ? file.notes : [];
const messages = Array.isArray(file.messages) ? file.messages : [];

const room = typeof file.room === 'string' && file.room ? file.room : '?';
const roomBpm = typeof file.bpm === 'number' && file.bpm > 0 ? file.bpm : null;
// `?` rather than a default key: the probe prints `?` when no room_state arrived, and the file's
// `C major` fallback is the writer's choice, not something the room said.
const roomKey = typeof file.key === 'string' && file.key ? file.key : '?';
const recordedMs = typeof file.recordedMs === 'number' && file.recordedMs >= 0 ? file.recordedMs : 0;

/** `C4` -> 0, `A#3` -> 10, `Bb4` -> 10: the pitch class the clash count compares. Null is not a pitch. */
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchClassNumber(pitch) {
  const m = /^([A-Ga-g])([#b]?)/.exec(String(pitch ?? '').trim());
  if (!m) return null;
  const base = NATURAL_PC[m[1].toUpperCase()];
  if (base === undefined) return null;
  if (m[2] === '#') return (base + 1) % 12;
  if (m[2] === 'b') return (base + 11) % 12;
  return base;
}

// THE TIER THE RUN ACTUALLY GOT, from the bar records' own meta as the probe recorded them. A
// browser export carries the same frames, because the recorder keeps the same message types.
let tierSeen = 'unknown';
for (const m of messages) {
  if (!m || m.type !== 'ai_debug') continue;
  const tier = m.data && m.data.meta ? m.data.meta.tier : undefined;
  if (typeof tier === 'string') tierSeen = tier;
}

const byAgent = new Map();
for (const b of bars) {
  const row = byAgent.get(b.agent) ?? { llm: 0, pattern: 0, rest: 0, cell: 0, fallback: 0, lastModelT: -1, lat: [] };
  row[b.source] = (row[b.source] ?? 0) + 1;
  if (b.source === 'llm' || b.source === 'rest') row.lastModelT = Math.max(row.lastModelT, b.t);
  if (typeof b.latencyMs === 'number' && b.source === 'llm') row.lat.push(b.latencyMs);
  byAgent.set(b.agent, row);
}
const lat = bars.filter(b => b.source === 'llm' && typeof b.latencyMs === 'number').map(b => b.latencyMs);
lat.sort((a, b) => a - b);
const errors = bars.filter(b => b.error);
const paced = bars.filter(b => typeof b.response === 'string' && b.response.includes('writes every'));
const perBar = new Map();
for (const b of bars) perBar.set(`${b.agent}@${b.t}`, (perBar.get(`${b.agent}@${b.t}`) ?? 0) + 1);
const dupBars = [...perBar.values()].filter(n => n > 1).length;

console.log(`room      ${room}  bpm ${roomBpm ?? '?'}  key ${roomKey}  tier ${tierSeen}` +
  `  gap rests ${typeof file.gapRests === 'boolean' ? (file.gapRests ? 'on' : 'off') : 'unknown'}`);
console.log(`recorded  ${(recordedMs / 1000).toFixed(1)} s   bar ${roomBpm ? (240000 / roomBpm).toFixed(0) : '?'} ms`);
// THE CARD'S FOUR NUMBERS, each counted from the rows beside it in the file.
console.log(`messages  ${messages.length}   notes ${notes.length}   bar records ${bars.length}   duplicate (agent,ms) ${dupBars}`);
// THE FOUR FILLS AND THE REST, EACH ON ITS OWN. `cell` is the agent's own short figures above a
// stride of one and `pattern` is the generator's line at a stride of one.
console.log(`model bars ${bars.filter(b => b.source === 'llm').length}  rest ${bars.filter(b => b.source === 'rest').length}` +
  `  cell ${bars.filter(b => b.source === 'cell').length}` +
  `  pattern ${bars.filter(b => b.source === 'pattern').length}  fallback ${bars.filter(b => b.source === 'fallback').length}` +
  `  late ${bars.filter(b => b.source === 'late').length}`);
// THE BARS THAT MISSED THEIR LINE, NAMED ONE BY ONE: a bar patched after its own line records
// source 'late' (jam-room.ts, latePatch).
const late = bars.filter(b => b.source === 'late');
if (late.length) {
  console.log(`late      ${late.length} bars patched after their own line, e.g. ${late[0].agent} t=${late[0].t} ${late[0].plan}`);
}
// THE CARD'S LATENCY LINE, from the model bars' own latencyMs, sorted the way the probe sorts it.
if (lat.length) {
  console.log(`latency   min ${lat[0]}  median ${lat[Math.floor(lat.length / 2)]}  max ${lat[lat.length - 1]} ms`);
}
const modelBars = bars.filter(b => b.source === 'llm' || b.source === 'fallback' || b.source === 'late');
const callsSpent = bars.reduce((n, b) => n + (typeof b.calls === 'number' ? b.calls : 0), 0);
const callsPerBar = modelBars.length ? (callsSpent / modelBars.length).toFixed(2) : 'n/a';
const twoCall = modelBars.filter(b => b.calls === 2).length;
const oneCall = modelBars.filter(b => b.calls === 1).length;
const priced = bars.some(b => typeof b.calls === 'number');
if (priced) {
  console.log(`calls     ${callsSpent} model calls over ${modelBars.length} model bars = ${callsPerBar} per model bar` +
    `   two-call bars ${twoCall}  one-call bars ${oneCall}` +
    `   worst latency ${lat.length ? `${lat[lat.length - 1]} ms` : 'n/a'}`);
} else {
  // `0 calls` would be a reading, not an absence: the browser export's bar rows do not name `calls`,
  // and an older probe file predates the field. Say the file cannot answer instead of pricing it at 0.
  console.log(`calls     not recorded in this file: no bar row carries a call count` +
    ` (${modelBars.length} model bars, worst latency ${lat.length ? `${lat[lat.length - 1]} ms` : 'n/a'})`);
}
const prompts = bars.map(b => b.prompt).filter(Boolean);
// THE BAND'S DYNAMICS, BAR BY BAR, from the notes the file kept. A bar's velocity profile is the
// weights its notes were played at; the newest bar record at or before a note is the bar it
// belongs to, because the room broadcasts the record and then the bar's notes at its line.
const publishes = new Map();
for (const b of bars) {
  if (!b.peerId) continue;
  const rows = publishes.get(b.peerId) ?? [];
  rows.push({ t: b.t, bar: b.bar });
  publishes.set(b.peerId, rows);
}
const barMs = roomBpm ? 240000 / roomBpm : 0;
// A NOTE-TO-BAR LINK IS ONLY THERE WHEN THE BAR ROWS CARRY `peerId`. The browser recorder's whitelist
// (session-recorder.ts) names every field a panel reads and does not name this one, so an export's
// bar rows carry no peer: printing `0 agent bars` and `0 clashes` for it would report a room that
// played nothing rather than a file that cannot answer. Say which.
const linked = bars.some(b => b.peerId);
const barOf = (n) => {
  const rows = publishes.get(n.peerId);
  if (!rows || !rows.length) return null;
  let at = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].t <= n.t + 20) { at = i; break; } // +20 ms: the reader's receipt, not the room's clock
  }
  if (at === -1) return null;
  const pub = rows[at];
  if (n.t - pub.t > barMs) return null;
  return pub;
};
const profiles = new Map();
for (const n of notes) {
  if (n.kind !== 'on') continue;
  const pub = barOf(n);
  if (!pub) continue;
  const key = `${n.peerId}@${pub.bar ?? 'p'}`;
  const row = profiles.get(key) ?? [];
  row.push(n.velocity);
  profiles.set(key, row);
}
const scored = [...profiles.values()].filter(v => v.length >= 2);
const sets = scored.map(v => [...v].sort((a, b) => a - b).join(' '));
const distinct = new Set(sets).size;
const flat = scored.filter(v => new Set(v).size === 1).length;
const examples = [...new Set(sets)].slice(0, 3).join('   |   ') || 'none';
if (linked) {
  console.log(`dynamics  agent bars ${scored.length}  distinct velocity sets ${distinct}  flat bars ${flat}` +
    `  e.g. ${examples}`);
} else if (notes.length) {
  console.log(`dynamics  not measurable: no bar record carries peerId (${notes.length} notes, ${bars.length} bar records)`);
} else {
  console.log('dynamics  no notes in this file');
}
// A SEMITONE BETWEEN TWO AGENTS IN ONE SLOT, COUNTED. This is the interval the band cannot agree
// on, and the reading a tonal-map change is measured by.
const slotPeople = new Map();
for (const n of notes) {
  if (n.kind !== 'on') continue;
  const pub = barOf(n);
  if (!pub || typeof pub.bar !== 'number') continue;
  const pc = pitchClassNumber(n.pitch);
  if (pc === null) continue;
  const slot = `${pub.bar}@${Math.round(Number(n.beatTime) * 4) / 4}`;
  const rows = slotPeople.get(slot) ?? [];
  rows.push({ peerId: n.peerId, pc });
  slotPeople.set(slot, rows);
}
let clashes = 0;
let clashSlots = 0;
for (const rows of slotPeople.values()) {
  let hit = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].peerId === rows[j].peerId) continue; // one agent's own two notes are not a clash
      const raw = Math.abs(rows[i].pc - rows[j].pc);
      if (Math.min(raw, 12 - raw) === 1) hit++; // a semitone, in either direction
    }
  }
  if (hit > 0) { clashes += hit; clashSlots++; }
}
if (linked) {
  console.log(`clashes   ${clashes} semitone pairs between two agents in one slot, across ${clashSlots} slots`);
} else if (notes.length) {
  console.log('clashes   not measurable: no bar record carries peerId');
}

// THE PROMPT READINGS ARE PRINTED ONLY WHEN THE FILE KEPT THE PROMPTS. A browser export's bar rows
// are a whitelist and do not carry `prompt` (session-recorder.ts), so a reader that printed
// `prompts 0` there would report an absence it never saw.
if (prompts.length) {
  const drumHits = prompts.filter(p => /strong beats:.*\b(C2|D3|A5)\b/.test(p)).length;
  const cellAsks = prompts.filter(p => p.includes('CELL ASK')).length;
  const tradeHalves = prompts.filter(p => p.includes('TRADE: half')).length;
  console.log(`prompts   ${prompts.length}  naming a drum code as a strong beat: ${drumHits}` +
    `  carrying a cell request: ${cellAsks}  carrying a trade half: ${tradeHalves}`);
  const earlier = prompts.filter(p => p.includes('EARLIER SESSION:'));
  const sample = earlier.length
    ? String(earlier[0].split('EARLIER SESSION:')[1] ?? '').split('\n')[0].trim()
    : '';
  console.log(`bank      ${earlier.length} prompts carry a motif from an earlier session` +
    (sample ? `, e.g. ${sample}` : ''));
}
// THE TRADE, AS THE FILE HEARD IT: every bar record carries the role the room gave its agent and
// the bar it was written for, so a two-bar trade reads as PAIRS per agent.
const rolesSeen = new Map();
for (const b of bars) {
  if (!b.agent || !b.role || typeof b.bar !== 'number') continue;
  rolesSeen.set(`${b.agent}@${b.bar}`, { agent: b.agent, bar: b.bar, role: b.role });
}
const rolesByAgent = new Map();
for (const r of [...rolesSeen.values()].sort((a, b) => a.bar - b.bar)) {
  const rows = rolesByAgent.get(r.agent) ?? [];
  rows.push(r);
  rolesByAgent.set(r.agent, rows);
}
for (const [agent, rows] of rolesByAgent) {
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.role === r.role && r.bar === last.to + 1) last.to = r.bar;
    else runs.push({ role: r.role, from: r.bar, to: r.bar });
  }
  const words = runs.map(x => `${x.role} ${x.from === x.to ? x.from : `${x.from}..${x.to}`}`).join('  ');
  console.log(`roles     ${String(agent).padEnd(14)} ${words}`);
}
if (paced.length) console.log(`paced     ${paced.length} bars paced by the tempo rule, e.g. "${paced[0].response}"`);
// THE PACE ON EVERY BAR, FROM THE META. The room publishes `stride` and `ceilingBpm` with every
// record it writes; a file from an older probe has neither and prints `none published`.
const strideCounts = new Map();
for (const b of bars) {
  if (typeof b.stride === 'number') strideCounts.set(b.stride, (strideCounts.get(b.stride) ?? 0) + 1);
}
const noStride = bars.filter(b => typeof b.stride !== 'number').length;
const paces = [...strideCounts].sort((a, b) => a[0] - b[0]).map(([s, n]) => `x${s} on ${n} bars`).join('  ');
console.log(`stride    ${paces || 'none published'}   bars without a stride ${noStride}`);
const ceilings = bars.map(b => b.ceilingBpm).filter(n => typeof n === 'number');
if (ceilings.length) {
  console.log(`ceiling   ${Math.min(...ceilings)} BPM, the slowest agent's one-bar-per-bar tempo` +
    ` (this room ${roomBpm ?? '?'} BPM)`);
}
for (const [agent, row] of byAgent) {
  console.log(`  ${String(agent).padEnd(14)} llm ${row.llm}  rest ${row.rest}  cell ${row.cell}  fallback ${row.fallback}` +
    `  pattern ${row.pattern}  last model t=${row.lastModelT}`);
}
if (errors.length) for (const e of errors.slice(0, 4)) console.log(`  FAILED ${e.agent} t=${e.t} ${e.error}`);
else console.log('  no AI failures');

// THE LAST LINE NAMES THE FILE READ, where the probe names the file it wrote. Everything above it
// is the same summary, which is what makes a probe run and a dropped file the same conversation.
console.log(`read      ${path}`);
