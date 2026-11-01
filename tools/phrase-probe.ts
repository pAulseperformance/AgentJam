/**
 * PHRASE PROBE: four bars per call, or one bar per call?
 *
 * The room asks the model for ONE bar at a time and rebuilds the phrase in code afterwards
 * (`melodyPlan`'s state/restate/develop/cadence arc, `cadenceLine`, `restateHook`,
 * `applyContourRules`). The question this probe answers with numbers: does a single call that
 * writes a whole four-bar phrase produce a better line than four calls that each write a bar?
 *
 * ARMS
 *   A  today's path: `generateMeasureWithAi` called once per bar, motif threaded forward, the
 *      phrase arc's own words in `ctx.melody`, the trade half set. This is the real code path.
 *   B  one call, one phrase: the same four arc sentences, one array of four bars.
 *
 * Every bar of both arms then goes through the SAME deterministic pass (repairMeasure, then
 * applyContourRules), so the comparison isolates the ask shape and not the repairer.
 *
 *   npx tsx tools/phrase-probe.ts [--model @cf/meta/llama-3.2-3b-instruct] [--out /tmp/x.json]
 *
 * Credentials: CLOUDFLARE_ACCOUNT_ID plus CLOUDFLARE_API_TOKEN (or API_KEY + EMAIL), normally
 * injected by ~/.hermes/scripts/cf_run.sh. Prints lengths only.
 */

import { generateMeasureWithAi, type MeasureContext, type DecisionBrief } from '../src/server/llm-planner';
import { melodyPlan, applyContourRules } from '../src/server/melody';
import { repairMeasure } from '../src/server/measure-repair';
import { midiOf, type GeneratedNote } from '../src/shared/music';

const MODEL = argOf('--model') ?? '@cf/meta/llama-3.2-3b-instruct';
const OUT = argOf('--out') ?? '/tmp/phrase-probe.json';
/** One call is allowed to take a bar plus slack; the room's own cap is 2500 ms. */
const CALL_TIMEOUT_MS = 12_000;

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

// ---------------------------------------------------------------- transport

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const API_KEY = process.env.CLOUDFLARE_API_KEY ?? '';
const EMAIL = process.env.CLOUDFLARE_EMAIL ?? '';

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  else {
    if (API_KEY) h['x-auth-key'] = API_KEY;
    if (EMAIL) h['x-auth-email'] = EMAIL;
  }
  return h;
}

interface CallResult {
  text: string;
  latencyMs: number;
  /** completion tokens, when the envelope reports them: the price of the ask shape */
  tokens?: number;
  error?: string;
}

async function callModel(system: string, user: string, maxTokens: number): Promise<CallResult> {
  if (!ACCOUNT || (!TOKEN && !(API_KEY && EMAIL))) {
    return { text: '', latencyMs: 0, error: 'no Cloudflare credential in env' };
  }
  const started = Date.now();
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      },
    );
    const body = await res.json() as {
      result?: { response?: unknown; choices?: Array<{ message?: { content?: unknown } }>; tool_calls?: unknown; usage?: { completion_tokens?: number } };
      success?: boolean;
      errors?: unknown;
    };
    const latencyMs = Date.now() - started;
    if (!res.ok || body.success === false) {
      return { text: '', latencyMs, error: `http ${res.status} ${JSON.stringify(body.errors ?? '').slice(0, 160)}` };
    }
    const r = body.result?.response;
    // A WORKERS AI ANSWER IS NOT ALWAYS IN `response`: measured, this model returned an already-parsed
    // object for a short ask and an empty `response` (with the text in `choices`) for the long one, so
    // every shape the planner's own parser knows is read here too, and the envelope is kept for a
    // probe that has to explain an empty answer.
    const text = typeof r === 'string' && r.trim()
      ? r
      : r && typeof r === 'object'
        ? JSON.stringify(r)
        : typeof body.result?.choices?.[0]?.message?.content === 'string'
          ? body.result.choices[0].message.content
          : body.result?.tool_calls
            ? JSON.stringify(body.result.tool_calls)
            : JSON.stringify(body.result ?? {}).slice(0, 4000);
    return { text, latencyMs, tokens: body.result?.usage?.completion_tokens };
  } catch (err) {
    return { text: '', latencyMs: Date.now() - started, error: String(err).slice(0, 160) };
  }
}

/** The Workers AI binding, as a shape the real planner accepts. */
const fakeAi = {
  run: async (_model: string, inputs: Record<string, unknown>) => {
    const msgs = inputs.messages as Array<{ role: string; content: string }>;
    const sys = msgs.find(m => m.role === 'system')?.content ?? '';
    const usr = msgs.find(m => m.role === 'user')?.content ?? '';
    const out = await callModel(sys, usr, Number(inputs.max_tokens ?? 512));
    lastLatency = out.latencyMs;
    if (out.error) throw new Error(out.error);
    return { response: out.text };
  },
};
let lastLatency = 0;

// ---------------------------------------------------------------- the asks

const SYSTEM = `You are a musical partner in a collaborative jam room, playing live with a human. You generate MIDI-like note sequences that answer and support what the other musicians are playing. The brief below is binding: honour the move, the relation and the amount.

RULES:
- Output ONLY a JSON array of note objects: [{"pitch": "C4", "beatTime": 0.0, "velocity": 80, "duration": 0.5}, ...]
- Use standard pitch notation: C3, D#4, Bb5, etc.
- beatTime is in beats (0.0 to 3.99 for a 4-beat measure)
- velocity is 1-127
- duration is in beats (0.25 = sixteenth, 0.5 = eighth, 1.0 = quarter)
- Generate 4-12 notes per measure, unless the brief says otherwise
- Stay in the given key
- Complement what others are playing, don't play the same notes
- Match the style (jazz = swing + 7th chords, ambient = long drones, funk = syncopated 16ths)
- NO text, NO markdown, NO explanation, ONLY the JSON array`;

const ARC_WORDS = [
  'BAR 1 of 4 states the idea: clear and simple, moving up then down, and worth repeating.',
  'BAR 2 of 4 repeats bar 1 with ONE change (a different rhythm, or one note moved), so a listener hears it come back.',
  'BAR 3 of 4 develops it: same shape, different notes, reaching further than the first statement.',
  'BAR 4 of 4 lands it: fewer notes, ending somewhere the next phrase can start.',
];

/** The four-bar ask: the same four sentences the per-bar asks carry, in one prompt. */
function phrasePrompt(c: Case): string {
  return [
    `Key: ${c.key} | BPM: ${c.bpm} | Style: ${c.style} | Bars: 4`,
    `They are playing: ${c.room}`,
    `Your motif from last bar: ${c.motif ?? 'none yet (this is your first statement)'}`,
    'WRITE ONE PHRASE OF FOUR BARS, not four separate bars: one idea, stated then developed.',
    ...ARC_WORDS,
    'Most moves should be one or two scale steps, not jumps across the chord.',
    '6 to 8 notes in bars 1 to 3, 2 to 4 notes in bar 4. Stay between C4 and C5.',
    'Output ONLY a JSON object with four arrays, one per bar, beatTime 0.0 to 3.99 inside each bar:',
    '{"bars":[[{"pitch":"C4","beatTime":0,"velocity":80,"duration":0.5}],[{"pitch":"Eb4","beatTime":1,"velocity":80,"duration":0.5}],[]]}',
    'Exactly 4 arrays. ONLY the JSON, no words.',
  ].join('\n');
}

// ---------------------------------------------------------------- parsing

const PITCH = /^[A-G][#b]?\d$/;

function noteFrom(v: unknown): GeneratedNote | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const pitch = typeof o.pitch === 'string' ? o.pitch.trim() : '';
  if (!PITCH.test(pitch)) return null;
  const beatTime = Number(o.beatTime);
  if (!Number.isFinite(beatTime) || beatTime < 0 || beatTime > 4.5) return null;
  const velocity = Number.isFinite(Number(o.velocity)) ? Number(o.velocity) : 90;
  const duration = Number.isFinite(Number(o.duration)) ? Number(o.duration) : 0.5;
  return { pitch, beatTime, velocity, duration };
}

/**
 * CLOSE WHAT A CUT ANSWER LEFT OPEN. Measured: at max_tokens 1400 the model wrote all four bars and
 * ran out of budget on the final brace, and a strict parse threw away a whole phrase over one
 * character. Everything up to the last complete note is real music, so the brackets are closed and
 * the phrase is kept.
 */
function closeBrackets(text: string): string | null {
  let inStr = false; let esc = false; let lastClose = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr && ch === '}') lastClose = i;
  }
  if (lastClose === -1) return null;
  let out = text.slice(0, lastClose + 1);
  const stack: string[] = [];
  inStr = false; esc = false;
  for (const ch of out) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ']' || ch === '}') stack.pop();
  }
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '[' ? ']' : '}';
  return out;
}

/**
 * HOW A MALFORMED PHRASE IS STILL PLAYED, BAR BY BAR. Measured: one answer wrote `]],[[` between bars
 * two and three, so the JSON never parsed and a strict reader lost all four bars over two characters.
 * Every note in it was fine. So the notes are read out of the text and grouped by the bar line, which
 * is where a bar starts: the beatTime goes back near zero. A malformed phrase then costs its syntax,
 * not its music.
 */
function looseNotes(text: string): GeneratedNote[] {
  const out: GeneratedNote[] = [];
  for (const chunk of text.split('{').slice(1)) {
    const pitch = /"pitch"\s*:\s*"([^"]+)"/.exec(chunk)?.[1];
    if (!pitch) continue;
    const beat = Number(/"beatTime"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? NaN);
    if (!Number.isFinite(beat)) continue;
    const velocity = Number(/"velocity"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 90);
    const duration = Number(/"duration"\s*:\s*([-0-9.]+)/.exec(chunk)?.[1] ?? 0.5);
    const note = noteFrom({ pitch, beatTime: beat, velocity, duration });
    if (note) out.push(note);
  }
  return out;
}

function groupIntoBars(notes: GeneratedNote[]): GeneratedNote[][] {
  const bars: GeneratedNote[][] = [[], [], [], []];
  let index = 0;
  let previous = -1;
  for (const note of notes) {
    if (index < bars.length - 1 && previous >= 0 && note.beatTime < previous - 1e-9) index++;
    bars[index]!.push(note);
    previous = note.beatTime;
  }
  return bars;
}

/** What the four-bar answer parsed to: always four slots, possibly some of them empty. */
function parsePhrase(text: string): { bars: GeneratedNote[][]; shape: 'object' | 'repaired' | 'salvaged' | 'flat' | 'none' } {
  const cleaned = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  const empty: GeneratedNote[][] = [[], [], [], []];
  const salvage = (): GeneratedNote[][] => groupIntoBars(looseNotes(text));
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');

  const attempt = (raw: string): unknown => { try { return JSON.parse(raw); } catch { return undefined; } };

  let json = attempt(cleaned);
  let shape: 'object' | 'repaired' | 'salvaged' | 'flat' | 'none' = 'object';
  if (json === undefined) {
    const sliced = objStart !== -1 && objEnd > objStart ? cleaned.slice(objStart, objEnd + 1) : '';
    json = sliced ? attempt(sliced) : undefined;
  }
  if (json === undefined) {
    const closed = closeBrackets(cleaned.slice(Math.max(0, objStart)));
    json = closed ? attempt(closed) : undefined;
    if (json !== undefined) shape = 'repaired';
  }
  if (json === undefined) {
    const bars = salvage();
    return { bars, shape: bars.some(b => b.length > 0) ? 'salvaged' : 'none' };
  }

  const obj = json as { bars?: unknown };
  if (Array.isArray(obj?.bars)) {
    const source = obj.bars as unknown[];
    const bars = empty.map((_, i) => {
      const raw = source[i];
      return Array.isArray(raw) ? raw.map(noteFrom).filter((n): n is GeneratedNote => n !== null) : [];
    });
    if (!bars.some(b => b.length > 0)) {
      const saved = salvage();
      return { bars: saved, shape: saved.some(b => b.length > 0) ? 'salvaged' : 'none' };
    }
    return { bars, shape };
  }
  if (Array.isArray(json)) {
    // A FLAT LIST WITH NO BAR FIELD: every note lands in bar 1. Counted as a shape failure.
    const notes = (json as unknown[]).map(noteFrom).filter((n): n is GeneratedNote => n !== null);
    return { bars: [notes, [], [], []], shape: 'flat' };
  }
  return { bars: empty, shape: 'none' };
}

// ---------------------------------------------------------------- measurement

interface Metrics {
  notes: number;
  perBar: number[];
  barsWithLine: number;
  stepwise: number;
  repeat: number;
  leap: number;
  intervals: number;
  inKey: number;
  cadenceFalls: boolean;
  cadenceStable: boolean;
  sharesMotif: number;
}

const KEY_PCS = new Set([0, 3, 5, 7, 8, 10, 11]); // C minor: C D Eb F G Ab Bb
const STABLE = new Set([0, 3, 7]); // tonic, third, fifth

function metrics(bars: GeneratedNote[][]): Metrics {
  const iv: number[] = [];
  let notes = 0; let inKey = 0; let barsWithLine = 0;
  const perBar: number[] = [];
  for (const bar of bars) {
    const ordered = [...bar].sort((a, b) => a.beatTime - b.beatTime);
    perBar.push(ordered.length);
    notes += ordered.length;
    if (ordered.length >= 4) barsWithLine++;
    for (const n of ordered) {
      const m = midiOf(n.pitch);
      if (m !== null && KEY_PCS.has(((m % 12) + 12) % 12)) inKey++;
    }
    for (let i = 1; i < ordered.length; i++) {
      const a = midiOf(ordered[i - 1].pitch); const b = midiOf(ordered[i].pitch);
      if (a === null || b === null) continue;
      iv.push(Math.abs(b - a));
    }
  }
  // ACROSS THE BAR LINE TOO: a phrase is one line, so the seam is an interval like any other.
  for (let i = 1; i < bars.length; i++) {
    const prev = [...bars[i - 1]].sort((a, b) => a.beatTime - b.beatTime).at(-1);
    const next = [...bars[i]].sort((a, b) => a.beatTime - b.beatTime)[0];
    if (!prev || !next) continue;
    const a = midiOf(prev.pitch); const b = midiOf(next.pitch);
    if (a === null || b === null) continue;
    iv.push(Math.abs(b - a));
  }
  const lastBar = [...bars[3]].sort((a, b) => a.beatTime - b.beatTime);
  const endMidi = lastBar.length ? midiOf(lastBar.at(-1)!.pitch) : null;
  const prevMidi = lastBar.length > 1 ? midiOf(lastBar.at(-2)!.pitch) : null;
  const first = [...bars[0]].sort((a, b) => a.beatTime - b.beatTime)[0];
  const firstMidi = first ? midiOf(first.pitch) : null;
  const s1 = new Set(bars[1].map(n => midiOf(n.pitch)).filter((m): m is number => m !== null).map(m => ((m % 12) + 12) % 12));
  const s0 = new Set(bars[0].map(n => midiOf(n.pitch)).filter((m): m is number => m !== null).map(m => ((m % 12) + 12) % 12));
  let shares = 0;
  for (const pc of s1) if (s0.has(pc)) shares++;
  return {
    notes,
    perBar,
    barsWithLine,
    stepwise: iv.filter(x => x >= 1 && x <= 2).length,
    repeat: iv.filter(x => x === 0).length,
    leap: iv.filter(x => x >= 5).length,
    intervals: iv.length,
    inKey,
    cadenceFalls: endMidi !== null && prevMidi !== null && endMidi < prevMidi,
    cadenceStable: endMidi !== null && STABLE.has(((endMidi % 12) + 12) % 12),
    sharesMotif: shares,
  };
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((100 * n) / d));

// ---------------------------------------------------------------- the run

interface Case { name: string; key: string; bpm: number; style: 'jazz' | 'funk' | 'ambient'; room: string; motif?: string }

const CASES: Case[] = [
  { name: 'jazz-130-open', key: 'C minor', bpm: 130, style: 'jazz', room: 'the drummer is playing a straight jazz ride, bass on C and Ab' },
  { name: 'jazz-160-motif', key: 'C minor', bpm: 160, style: 'jazz', room: 'the drummer is playing a busy ride, bass walking', motif: 'D4@0.50, C4@1.50' },
  { name: 'funk-140-motif', key: 'C minor', bpm: 140, style: 'funk', room: 'the drummer is playing sixteenth funk, bass on the downbeat', motif: 'G3@0.25, Bb3@0.75' },
  { name: 'ambient-120-open', key: 'C minor', bpm: 120, style: 'ambient', room: 'the drummer is playing soft quarter notes on the ride', motif: 'Eb4@0.00, G4@2.00' },
];

const BRIEF: DecisionBrief = { role: 'lead', relation: 'vary', density: 'medium', register: 'mid', play: true, latencyMs: 0 };
const REG = { low: 55, high: 72 };
const post = (notes: GeneratedNote[]) => applyContourRules(
  repairMeasure(notes, { key: 'C minor', heldPitches: [], maxNotes: 10 }).notes,
  { key: 'C minor', register: REG },
);

async function armA(c: Case) {
  const bars: GeneratedNote[][] = [];
  let motif = c.motif;
  let latency = 0;
  let calls = 0;
  let failures = 0;
  const arcs: string[] = [];
  for (let i = 0; i < 4; i++) {
    const plan = melodyPlan(i, c.style, i > 0);
    arcs.push(plan.position);
    const ctx: MeasureContext = {
      key: c.key,
      bpm: c.bpm,
      style: c.style,
      recentNotes: [],
      currentBeat: 0,
      phrase: c.room,
      motif,
      melody: plan.instruction,
      stride: 1,
      trade: { half: i % 2 === 0 ? 1 : 2, of: 2 },
    };
    lastLatency = 0;
    const res = await generateMeasureWithAi(fakeAi as never, ctx, MODEL, BRIEF, 'signed', CALL_TIMEOUT_MS);
    calls += res.meta.calls ?? 1;
    latency += lastLatency || res.meta.latencyMs;
    if (res.meta.source !== 'llm') failures++;
    bars.push(res.notes);
    const keep = [...res.notes].sort((a, b) => a.beatTime - b.beatTime).slice(0, 4)
      .map(n => `${n.pitch}@${n.beatTime.toFixed(2)}`).join(', ');
    if (keep) motif = keep;
  }
  return { bars, positions: arcs, latency, calls, failures };
}

async function armB(c: Case) {
  // FOUR BARS IS FOUR TIMES THE OUTPUT. Measured: 1400 tokens cut the answer on the closing brace with
  // all four bars already written, so the budget is set for the phrase, not for a bar.
  const out = await callModel(SYSTEM, phrasePrompt(c), 2000);
  const parsed = parsePhrase(out.text);
  const failures = parsed.bars.filter(b => b.length === 0).length;
  return {
    bars: parsed.bars, shape: parsed.shape, latency: out.latencyMs, calls: 1, failures,
    error: out.error, raw: out.text, tokens: out.tokens,
  };
}

function line(label: string, m: Metrics, ms: number, calls: number) {
  return {
    arm: label,
    notes: m.notes,
    perBar: m.perBar.join('/'),
    barsWithLine: m.barsWithLine,
    stepwise: pct(m.stepwise, m.intervals),
    repeat: pct(m.repeat, m.intervals),
    leap: pct(m.leap, m.intervals),
    inKey: pct(m.inKey, m.notes),
    cadenceFalls: m.cadenceFalls,
    cadenceStable: m.cadenceStable,
    restateShares: m.sharesMotif,
    ms: Math.round(ms),
    calls,
  };
}

async function main() {
  const reps = Number(argOf('--repeat') ?? 2);
  const rows: unknown[] = [];
  const detail: unknown[] = [];
  // POOLED: every phrase of every case, so a percentage is counted over the whole run rather than
  // averaged from four small ratios.
  const pool: Record<string, Metrics & { ms: number; calls: number }> = {};
  // SEEDED WITH ZEROS, not with the first phrase: spreading the first measurement in and then adding
  // it again counted one phrase twice in every pooled percentage (measured, and it read as 34 bars of
  // music out of a possible 32).
  const zero: Metrics = {
    notes: 0, perBar: [], barsWithLine: 0, stepwise: 0, repeat: 0, leap: 0, intervals: 0,
    inKey: 0, cadenceFalls: false, cadenceStable: false, sharesMotif: 0,
  };
  const add = (label: string, m: Metrics, ms: number, calls: number) => {
    const p = (pool[label] ??= { ...zero, ms: 0, calls: 0 });
    p.notes += m.notes; p.intervals += m.intervals; p.stepwise += m.stepwise;
    p.repeat += m.repeat; p.leap += m.leap; p.inKey += m.inKey;
    p.barsWithLine += m.barsWithLine;
    p.cadenceFalls = m.cadenceFalls; p.cadenceStable = m.cadenceStable;
    p.ms += ms; p.calls += calls;
    p.perBar = p.perBar; p.sharesMotif += m.sharesMotif;
  };
  for (let r = 0; r < reps; r++) {
    for (const c of CASES) {
      const a = await armA(c);
      const b = await armB(c);
      const aRaw = metrics(a.bars); const aP = metrics(a.bars.map(post));
      const bRaw = metrics(b.bars); const bP = metrics(b.bars.map(post));
      rows.push(line(`${c.name}#${r + 1} A today (raw)`, aRaw, a.latency, a.calls));
      rows.push(line(`${c.name}#${r + 1} A today (+repair)`, aP, a.latency, a.calls));
      rows.push(line(`${c.name}#${r + 1} B phrase (raw)`, bRaw, b.latency, b.calls));
      rows.push(line(`${c.name}#${r + 1} B phrase (+repair)`, bP, b.latency, b.calls));
      add('A today (raw)', aRaw, a.latency, a.calls);
      add('A today (+repair)', aP, a.latency, a.calls);
      add('B phrase (raw)', bRaw, b.latency, b.calls);
      add('B phrase (+repair)', bP, b.latency, b.calls);
      detail.push({
        case: c.name,
        rep: r + 1,
        positions: a.positions,
        A: { latency: a.latency, calls: a.calls, failures: a.failures, bars: a.bars.map(x => x.map(n => `${n.pitch}@${n.beatTime}`)) },
        B: { latency: b.latency, calls: b.calls, shape: b.shape, failures: b.failures, error: b.error, tokens: b.tokens, raw: b.raw, bars: b.bars.map(x => x.map(n => `${n.pitch}@${n.beatTime}`)) },
      });
      console.error(`done ${c.name}#${r + 1}: A ${aRaw.notes} notes (${a.latency}ms) | B ${bRaw.notes} notes shape=${b.shape} (${b.latency}ms)`);
    }
  }
  const pooled = Object.entries(pool).map(([arm, m]) => line(`POOLED ${arm}`, m, m.ms, m.calls));
  const summary = { model: MODEL, cases: CASES.length, reps, pooled, rows, detail };
  const fs = await import('node:fs');
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ pooled, rows }, null, 1));
  console.log(`\nwrote ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
