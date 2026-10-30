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
    `  pattern ${bars.filter(b => b.source === 'pattern').length}  fallback ${bars.filter(b => b.source === 'fallback').length}`);
  if (lat.length) {
    console.log(`latency   min ${lat[0]}  median ${lat[Math.floor(lat.length / 2)]}  max ${lat[lat.length - 1]} ms`);
  }
  const prompts = bars.map(b => b.prompt).filter(Boolean);
  if (prompts.length) {
    const drumHits = prompts.filter(p => /strong beats:.*\b(C2|D3|A5)\b/.test(p)).length;
    // THE TAIL-AWARE ASK, COUNTED. A prompt carries `CELL ASK` when the room asked for two notes in a
    // named slot instead of a bar because the agent's tail did not fit the bar (llm-planner.ts,
    // CELL_ASK). Task 4's acceptance is this number being at least one at 200 BPM.
    const cellAsks = prompts.filter(p => p.includes('CELL ASK')).length;
    console.log(`prompts   ${prompts.length}  naming a drum code as a strong beat: ${drumHits}` +
      `  carrying a cell request: ${cellAsks}`);
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
