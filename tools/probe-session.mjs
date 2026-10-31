#!/usr/bin/env node
/**
 * SESSION PROBE.
 *
 * The room's only honest judge is a listener, but a listener cannot be asked to spawn three agents, sit
 * through a minute at 200 BPM and then hand over an export. So this joins the live room over the same
 * WebSocket a browser uses, spawns the agents, records every message the client recorder keeps, and
 * writes the same session file: `room`, `bpm`, `key`, `transportStartTime`, `recordedMs`, `notes`,
 * `bars`, `messages`. A run is then one command and a file the two of us read the same way.
 *
 * A door cookie is optional. With it the room answers as a signed listener and the agents are judged by
 * Jev; without it the agents are public and render straight from the free model. The summary prints
 * which one happened, so a probe run never has to guess at the tier.
 *
 *   node tools/probe-session.mjs --bpm 200 --seconds 60 --agents jazz,funk,ambient --out /tmp/x.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const MAX_MESSAGES = 5000;
const RECORD = /note_o|ai_debug|agent_spawned|peer_|bpm_change|key_change|error/;

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

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const host = arg('host', 'zpe.vc');
const mount = arg('mount', '/jam');
const bpm = Number(arg('bpm', 160));
const seconds = Number(arg('seconds', 60));
const agents = String(arg('agents', 'jazz,funk,ambient')).split(',').map(a => a.trim()).filter(Boolean);
const room = arg('room', `probe-${Math.random().toString(36).slice(2, 10)}`);
const out = arg('out', `/tmp/jam-probe-${bpm}-${seconds}s.json`);
const cookieFile = arg('cookie-file', `${process.env.HOME}/.hermes/secrets/door-session-cookie.txt`);
// WHEN each agent is spawned, in ms after the join. A spawn late in a bar is the cold-start case: it
// used to inherit whatever was left of the bar and fail. Default spreads three agents over half a second.
const spawnAt = String(arg('spawn-at', '')).split(',').filter(Boolean).map(Number);
// The room's own drummer and bass. A probe that never switches them on cannot see how the agents treat
// them, and their fixed figure reached the prompt as "strong beats" until it was filtered out.
const backing = arg('backing', '') !== '';
// THE HEDGED ASK. Off is the room's default, so a probe that never asks cannot see what the second
// call buys: `--hedge` turns it on before the agents spawn and the summary prints the spend per bar.
// A bare flag, because there is nothing to tune here: one gap, one setting, off or on.
const hedge = process.argv.includes('--hedge');

let cookie = '';
try { cookie = readFileSync(cookieFile, 'utf8').trim(); } catch { /* public tier */ }

const startedAt = Date.now();
const messages = [];
const notes = [];
const bars = [];
const meta = { room, bpm: null, key: null, transportStartTime: null };
let tierSeen = 'unknown';

const ws = new WebSocket(`wss://${host}${mount}/api/room/${room}/ws`, {
  headers: cookie ? { cookie } : {},
});

const send = (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };

ws.on('open', () => {
  send({ type: 'join_room', name: 'Probe', kind: 'human', instrument: 'PolySynth' });
  setTimeout(() => send({ type: 'bpm_change', bpm }), 250);
  if (backing) setTimeout(() => send({ type: 'set_backing', drummer: true, bass: true }), 350);
  // BEFORE ANY AGENT: the pair is a property of the room, so it must be on when the first bar is asked
  // for, or the run measures the default instead of the setting.
  if (hedge) setTimeout(() => send({ type: 'set_hedge', enabled: true }), 300);
  agents.forEach((style, i) => {
    const at = spawnAt[i] ?? (500 + i * 250);
    setTimeout(() => send({ type: 'spawn_agent', name: `Probe ${style}`, style }), at);
  });
});

ws.on('message', (buf) => {
  let data;
  try { data = JSON.parse(buf.toString()); } catch { return; }
  const type = String(data.type ?? 'unknown');
  if (!RECORD.test(type)) return;

  const t = Date.now() - startedAt;
  messages.push({ t, type, data });
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);

  if (type === 'room_state' && data.roomState) {
    meta.bpm = data.roomState.bpm ?? null;
    meta.key = data.roomState.key ?? null;
    meta.transportStartTime = data.roomState.transportStartTime ?? null;
  }
  if (type === 'note_on' || type === 'note_off') {
    notes.push({
      t,
      peerId: String(data.peerId ?? ''),
      pitch: String(data.pitch ?? ''),
      velocity: Number(data.velocity ?? 0),
      beatTime: Number(data.beatTime ?? 0),
      kind: type === 'note_on' ? 'on' : 'off',
    });
  }
  if (type === 'ai_debug') {
    const m = data.meta ?? {};
    const brief = m.brief ?? {};
    if (typeof m.tier === 'string') tierSeen = m.tier;
    bars.push({
      t,
      agent: data.agentName ?? null,
      source: m.source ?? null,
      model: m.model ?? null,
      latencyMs: m.latencyMs ?? null,
      noteCount: m.noteCount ?? null,
      plan: m.plan ?? null,
      refreshed: m.refreshed ?? false,
      completed: m.completed ?? 0,
      role: brief.role ?? null,
      density: brief.density ?? null,
      register: brief.register ?? null,
      relation: brief.relation ?? null,
      error: m.error ?? null,
      response: m.response ?? null,
      prompt: m.prompt ?? null,
      // THE SPEND, FROM THE BAR'S OWN RECORD. `calls` is what the room charged this bar: 0 for a
      // rest or a pattern agent, 1 normally, 2 when the ask was hedged (llm-planner.ts).
      calls: typeof m.calls === 'number' ? m.calls : null,
      ask: m.ask ?? null,
      // THE BAR THIS RECORD IS FOR, and the peer that wrote it: the reader below needs both to say
      // which velocity profile belongs to which bar of which agent.
      peerId: data.agentPeerId ?? null,
      bar: typeof data.bar === 'number' ? data.bar : null,
    });
  }
});

function report() {
  const recordedMs = Date.now() - startedAt;
  const byAgent = new Map();
  for (const b of bars) {
    const row = byAgent.get(b.agent) ?? { llm: 0, pattern: 0, rest: 0, fallback: 0, lastModelT: -1, lat: [] };
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

  console.log(`room      ${room}  bpm ${meta.bpm ?? bpm}  key ${meta.key ?? '?'}  tier ${tierSeen}`);
  console.log(`recorded  ${(recordedMs / 1000).toFixed(1)} s   bar ${(240000 / (meta.bpm ?? bpm)).toFixed(0)} ms`);
  console.log(`messages  ${messages.length}   notes ${notes.length}   bar records ${bars.length}   duplicate (agent,ms) ${dupBars}`);
  console.log(`model bars ${bars.filter(b => b.source === 'llm').length}  rest ${bars.filter(b => b.source === 'rest').length}` +
    `  pattern ${bars.filter(b => b.source === 'pattern').length}  fallback ${bars.filter(b => b.source === 'fallback').length}` +
    `  late ${bars.filter(b => b.source === 'late').length}`);
  // THE BARS THAT MISSED THEIR LINE, NAMED ONE BY ONE. A bar patched after its own line records
  // source 'late' (jam-room.ts, latePatch): it is the model's own answer, played into the eighths
  // still ahead. Printing the agent and what it played is how a run shows the patch happened.
  const late = bars.filter(b => b.source === 'late');
  if (late.length) {
    console.log(`late      ${late.length} bars patched after their own line, e.g. ${late[0].agent} t=${late[0].t} ${late[0].plan}`);
  }
  if (lat.length) {
    console.log(`latency   min ${lat[0]}  median ${lat[Math.floor(lat.length / 2)]}  max ${lat[lat.length - 1]} ms`);
  }
  // THE HEDGE, PRICED FROM THE SESSION FILE. Each model bar records how many calls it spent, so the
  // two settings compare on the card's two readings — calls per bar and worst latency — without
  // trusting a description of what the setting does.
  const modelBars = bars.filter(b => b.source === 'llm' || b.source === 'fallback' || b.source === 'late');
  const callsSpent = bars.reduce((n, b) => n + (typeof b.calls === 'number' ? b.calls : 0), 0);
  const callsPerBar = modelBars.length ? (callsSpent / modelBars.length).toFixed(2) : 'n/a';
  const twoCall = modelBars.filter(b => b.calls === 2).length;
  const oneCall = modelBars.filter(b => b.calls === 1).length;
  console.log(`calls     ${callsSpent} model calls over ${modelBars.length} model bars = ${callsPerBar} per model bar` +
    `   two-call bars ${twoCall}  one-call bars ${oneCall}` +
    `   worst latency ${lat.length ? `${lat[lat.length - 1]} ms` : 'n/a'}`);
  const prompts = bars.map(b => b.prompt).filter(Boolean);
  // THE BAND'S DYNAMICS, BAR BY BAR. A bar's velocity profile is the weights its notes were played at.
  // With ONE accent map for the room, two bars are two profiles; a bar where every note carries the
  // same weight is the typewriter the map exists to stop. Notes are attributed to the bar record they
  // were published with: the room broadcasts the record and then the bar's notes at its line, so the
  // newest record at or before a note is the bar it belongs to.
  const publishes = new Map();
  for (const b of bars) {
    if (!b.peerId) continue;
    const rows = publishes.get(b.peerId) ?? [];
    rows.push({ t: b.t, bar: b.bar });
    publishes.set(b.peerId, rows);
  }
  const barMs = 240000 / (meta.bpm ?? bpm);
  // WHICH BAR A NOTE BELONGS TO. The room broadcasts a bar's record and then its notes at the same
  // line, so the newest record at or before a note is the bar it plays in. A note more than a bar
  // after its record is not that bar's.
  const barOf = (n) => {
    const rows = publishes.get(n.peerId);
    if (!rows || !rows.length) return null;
    let at = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].t <= n.t + 20) { at = i; break; } // +20 ms: the probe's receipt, not the room's clock
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
  // DISTINCT profiles, so an example never shows the same set twice: the reading is how many different
  // velocity sets the room played, and the samples are three of them.
  const examples = [...new Set(sets)].slice(0, 3).join('   |   ') || 'none';
  console.log(`dynamics  agent bars ${scored.length}  distinct velocity sets ${distinct}  flat bars ${flat}` +
    `  e.g. ${examples}`);
  // A SEMITONE BETWEEN TWO AGENTS IN ONE SLOT, COUNTED. This is the interval the band cannot agree
  // on: E against F, B against C, or any pair a whole tone apart on the grid. The room's tonal map
  // (src/server/tonal-map.ts) exists to keep a bar that would put two agents a semitone apart out of
  // the slot, so the reading a change is measured by is this count FALLING while model bars stay up.
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
  console.log(`clashes   ${clashes} semitone pairs between two agents in one slot, across ${clashSlots} slots`);

  if (prompts.length) {
    const drumHits = prompts.filter(p => /strong beats:.*\b(C2|D3|A5)\b/.test(p)).length;
    // THE TAIL-AWARE ASK, COUNTED. A prompt carries `CELL ASK` when the room asked for two notes in a
    // named slot instead of a bar because the agent's tail did not fit the bar (llm-planner.ts,
    // CELL_ASK). Task 4's acceptance is this number being at least one at 200 BPM.
    const cellAsks = prompts.filter(p => p.includes('CELL ASK')).length;
    // THE TRADE HALF, COUNTED. A prompt carries `TRADE: half n of m` when the room is trading in
    // turns (llm-planner.ts, TRADE_MARK): the bar knows which half of a two-bar statement it is.
    const tradeHalves = prompts.filter(p => p.includes('TRADE: half')).length;
    console.log(`prompts   ${prompts.length}  naming a drum code as a strong beat: ${drumHits}` +
      `  carrying a cell request: ${cellAsks}  carrying a trade half: ${tradeHalves}`);
    // THE ROOM'S MEMORY, COUNTED. A prompt carries `EARLIER SESSION:` when the room's motif bank
    // offered this agent a statement it left here on an earlier session (motif-bank.ts, Task 11).
    // Run twice on the same room id and the second run prints the first run's line here; a room
    // that never writes the bank prints zero both times.
    const earlier = prompts.filter(p => p.includes('EARLIER SESSION:'));
    const sample = earlier.length
      ? String(earlier[0].split('EARLIER SESSION:')[1] ?? '').split('\n')[0].trim()
      : '';
    console.log(`bank      ${earlier.length} prompts carry a motif from an earlier session` +
      (sample ? `, e.g. ${sample}` : ''));
  }
  // THE TRADE, AS THE PROBE HEARD IT. Every bar record carries the role the room gave its agent and
  // the bar it was written for, so a two-bar trade reads as PAIRS per agent (lead 0..1, answer 2..3)
  // and a one-bar rotation reads bar by bar (lead 0, answer 1, lead 2, answer 3). Bars are collapsed
  // into runs of one role on consecutive bars; the last record for a bar wins over a refresh.
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
  for (const [agent, row] of byAgent) {
    console.log(`  ${String(agent).padEnd(14)} llm ${row.llm}  rest ${row.rest}  fallback ${row.fallback}` +
      `  pattern ${row.pattern}  last model t=${row.lastModelT}`);
  }
  if (errors.length) for (const e of errors.slice(0, 4)) console.log(`  FAILED ${e.agent} t=${e.t} ${e.error}`);
  else console.log('  no AI failures');

  const file = {
    room, bpm: meta.bpm ?? bpm, key: meta.key ?? 'C major', transportStartTime: meta.transportStartTime,
    recordedMs, noteCount: notes.length, notes, bars, messages,
  };
  writeFileSync(out, JSON.stringify(file));
  console.log(`written   ${out}`);
}

setTimeout(() => { try { ws.close(); } catch { /* already closed */ } report(); }, seconds * 1000);
ws.on('error', (err) => { console.error('socket error:', err.message); });
