/**
 * PHRASE PROBE, STAGE TWO: run a stored probe through the room's own per-bar pipeline.
 *
 * `phrase-probe.ts` measures the model's raw bars. The room never plays a raw bar: it repairs it,
 * completes a thin one along the phrase arc, and applies the contour rules. This script applies those
 * same three passes to BOTH arms of a stored probe, so the comparison is finally the one a listener
 * makes: the bars as they would be heard.
 *
 *   npx tsx tools/phrase-apply.ts --in /tmp/phrase-probe.json
 */

import { melodyPlan, applyContourRules, completeMelody, cadenceFrom, leadInto, shapeLine, pulseAccentMap } from '../src/server/melody';
import { repairMeasure } from '../src/server/measure-repair';
import type { GeneratedNote } from '../src/shared/music';

const IN = arg('--in') ?? '/tmp/phrase-probe.json';
const KEY = 'C minor';
const REGISTER = { low: 55, high: 72 };

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const SEMI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const midi = (pitch: string): number | null => {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(pitch);
  if (!m) return null;
  return SEMI[m[1]!]! + 12 * (Number(m[2]) + 1);
};

/** `"D#4@0.5"` back into a note, the spelling the probe wrote. */
function decode(bars: string[][]): GeneratedNote[][] {
  return bars.map(bar => bar.map(s => {
    const [pitch, beat] = s.split('@');
    return { pitch: pitch!, beatTime: Number(beat), velocity: 90, duration: 0.25 };
  }));
}

/**
 * THE PASSES A LEAD BAR GETS IN THE ROOM, IN THE ROOM'S ORDER: repair, then the arc's own pass (a
 * cadence bar resolves its ending, a lead bar that is not a line is completed), then the bar line's
 * lead-in, then the contour rules, then the shaping the room applies with its accent map.
 *
 * WHAT THIS REPLAY DOES NOT CARRY, said here because the numbers depend on it: the cross-agent clash
 * filter (one agent, so nothing to clash with), the stored hook a restate bar would bring back (a
 * replay has no previous session's hook), and the Jev brief (the register and density are fixed).
 * The accent map is the bar's own pulse, because a replay has no drummer to follow.
 */
function heard(bars: GeneratedNote[][], opts: { gapOnly?: boolean } = {}): GeneratedNote[][] {
  const out: GeneratedNote[][] = [];
  bars.forEach((bar, i) => {
    const plan = melodyPlan(i, 'jazz', i > 0);
    const repaired = repairMeasure(bar, { key: KEY, heldPitches: [], maxNotes: 10 }).notes;
    // A PHRASE TOP-UP HAS TO LEAVE THE PHRASE ALONE. The room completes a bar that "is not a line",
    // which on a four-bar answer also rewrites the rhythm bar 2 was written to repeat. `gapOnly` fills
    // a bar that has almost nothing in it and keeps every bar that already says something.
    let line: GeneratedNote[];
    if (plan.position === 'cadence') {
      line = cadenceFrom(repaired, { key: KEY, register: REGISTER });
    } else if (opts.gapOnly && repaired.length >= 4) {
      line = repaired;
    } else {
      line = completeMelody(repaired, { plan, key: KEY, motif: null, register: REGISTER, maxNotes: 10 }).notes;
    }
    // THE PHRASE PASSES ACROSS THE BAR LINE: the first note starts a step out of the note the bar
    // before left ringing.
    const previous = out[i - 1]?.slice().sort((a, c) => a.beatTime - c.beatTime).at(-1);
    const fromMidi = previous ? midi(previous.pitch) : null;
    if (fromMidi !== null) line = leadInto(line, { fromMidi, key: KEY, register: REGISTER });
    line = applyContourRules(line, { key: KEY, register: REGISTER });
    line = shapeLine(line, { contour: plan.contour, density: 'medium', accents: pulseAccentMap(i) });
    out.push(line);
  });
  return out;
}

interface Tally {
  phrases: number; notes: number; bars: number; line: number; empty: number;
  iv: number; step: number; rep: number; leap: number;
  share2: number; sameRhythm: number; thins: number; stable: number;
}
const blank = (): Tally => ({
  phrases: 0, notes: 0, bars: 0, line: 0, empty: 0, iv: 0, step: 0, rep: 0, leap: 0,
  share2: 0, sameRhythm: 0, thins: 0, stable: 0,
});

function measure(t: Tally, bars: GeneratedNote[][]): void {
  const sorted = bars.map(b => [...b].sort((a, c) => a.beatTime - c.beatTime));
  t.phrases += 1;
  const per = sorted.map(b => b.length);
  t.notes += per.reduce((a, b) => a + b, 0);
  t.bars += sorted.length;
  t.line += per.filter(n => n >= 4).length;
  t.empty += per.filter(n => n === 0).length;
  const intervals: number[] = [];
  for (const bar of sorted) {
    for (let i = 1; i < bar.length; i++) {
      const a = midi(bar[i - 1]!.pitch); const b = midi(bar[i]!.pitch);
      if (a !== null && b !== null) intervals.push(Math.abs(b - a));
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.at(-1); const next = sorted[i]![0];
    if (!prev || !next) continue;
    const a = midi(prev.pitch); const b = midi(next.pitch);
    if (a !== null && b !== null) intervals.push(Math.abs(b - a));
  }
  t.iv += intervals.length;
  t.step += intervals.filter(x => x >= 1 && x <= 2).length;
  t.rep += intervals.filter(x => x === 0).length;
  t.leap += intervals.filter(x => x >= 5).length;
  const pc = (bar: GeneratedNote[]) => new Set(bar.map(n => midi(n.pitch)).filter((m): m is number => m !== null).map(m => ((m % 12) + 12) % 12));
  const p0 = pc(sorted[0] ?? []); const p1 = pc(sorted[1] ?? []);
  let shared = 0;
  for (const x of p1) if (p0.has(x)) shared++;
  if (shared >= 2) t.share2 += 1;
  const r0 = (sorted[0] ?? []).map(n => n.beatTime).join(',');
  const r1 = (sorted[1] ?? []).map(n => n.beatTime).join(',');
  if (r0.length > 0 && r0 === r1) t.sameRhythm += 1;
  if ((sorted[3]?.length ?? 0) < (sorted[0]?.length ?? 0)) t.thins += 1;
  const last = sorted[3]?.at(-1);
  const lm = last ? midi(last.pitch) : null;
  if (lm !== null && [0, 3, 7].includes(((lm % 12) + 12) % 12)) t.stable += 1;
}

function row(label: string, t: Tally): string {
  const p = (n: number, d: number) => (d === 0 ? 0 : Math.round((100 * n) / d));
  return [
    label.padEnd(22),
    `notes ${String(t.notes).padStart(4)}`,
    `${(t.notes / t.bars).toFixed(1)}/bar`,
    `line ${String(t.line).padStart(2)}/${t.bars}`,
    `empty ${t.empty}`,
    `step ${String(p(t.step, t.iv)).padStart(3)}%`,
    `rep ${String(p(t.rep, t.iv)).padStart(2)}%`,
    `leap ${String(p(t.leap, t.iv)).padStart(3)}%`,
    `| restates-rhythm ${t.sameRhythm}/${t.phrases}`,
    `shares-2pc ${t.share2}/${t.phrases}`,
    `lands-thin ${t.thins}/${t.phrases}`,
    `ends-C/Eb/G ${t.stable}/${t.phrases}`,
  ].join('  ');
}

async function main() {
  const fs = await import('node:fs');
  const probe = JSON.parse(fs.readFileSync(IN, 'utf8')) as {
    model: string;
    detail: Array<{ case: string; A: { bars: string[][] }; B: { bars: string[][] } }>;
  };
  const raw = { A: blank(), B: blank() };
  const played = { A: blank(), B: blank(), Bgap: blank() };
  for (const c of probe.detail) {
    const a = decode(c.A.bars); const b = decode(c.B.bars);
    measure(raw.A, a); measure(raw.B, b);
    measure(played.A, heard(a)); measure(played.B, heard(b));
    measure(played.Bgap, heard(b, { gapOnly: true }));
  }
  console.log(`model: ${probe.model}  phrases: ${probe.detail.length}\n`);
  console.log('AS THE MODEL WROTE IT');
  // The raw rows are the model's own notes: no repair, no arc, no shaping.
  console.log(row('A four one-bar calls', raw.A));
  console.log(row('B one four-bar call', raw.B));
  console.log('\nAS THE ROOM WOULD PLAY IT (repair, arc, lead-in, contour, shape; one agent, no clash filter)');
  console.log(row('A four one-bar calls', played.A));
  console.log(row('B one four-bar call', played.B));
  console.log(row('B + gap-only top-up', played.Bgap));
}

main().catch(err => { console.error(err); process.exit(1); });
