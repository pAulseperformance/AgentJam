/**
 * WHERE THE MODEL'S NOTES GO: replay a recorded session's own model answers through the room's bar
 * pipeline, one pass at a time, and count what each pass keeps.
 *
 * The session file already carries both ends: `ai_debug.meta.response` is what the model wrote, and
 * `meta.plan` is what the room queued. A third of the notes disappear between them and this says which
 * pass takes them.
 *
 *   npx tsx tools/note-loss.ts --in ~/.hermes/attachments/jam-session-default-room-2026-11-01T14-56-37-736Z.json
 */

import { parseAiResponse } from '../src/server/llm-planner';
import { melodyPlan, applyContourRules, completeMelody, cadenceFrom, leadInto, shapeLine } from '../src/server/melody';
import { repairMeasure } from '../src/server/measure-repair';
import type { GeneratedNote } from '../src/shared/music';

const IN = arg('--in') ?? '';
const REGISTER = { low: 55, high: 72 };

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

interface Row {
  bar: number;
  position: string;
  written: number;
  afterRepair: number;
  afterComplete: number;
  afterArc: number;
  afterContour: number;
  afterShape: number;
  planned: number;
}

function positionOf(prompt: string): string {
  if (prompt.includes('This bar states the idea')) return 'state';
  if (prompt.includes('repeats the idea with ONE CHANGE')) return 'restate';
  if (prompt.includes('develops the idea')) return 'develop';
  if (prompt.includes('lands the phrase')) return 'cadence';
  return '?';
}

async function main() {
  if (!IN) throw new Error('--in <session.json>');
  const fs = await import('node:fs');
  const session = JSON.parse(fs.readFileSync(IN, 'utf8')) as {
    key: string;
    messages: Array<{ type: string; data: { meta?: Record<string, unknown> } }>;
  };
  const key = session.key || 'C minor';
  const rows: Row[] = [];

  let motif: string | undefined;
  for (const m of session.messages) {
    if (m.type !== 'ai_debug') continue;
    const meta = m.data.meta;
    if (!meta || meta.source !== 'llm') continue;
    const written = parseAiResponse(meta.response) ?? [];
    if (written.length === 0) continue;
    const position = positionOf(String(meta.prompt ?? ''));
    const idx = ['state', 'restate', 'develop', 'cadence'].indexOf(position);
    const plan = melodyPlan(idx < 0 ? 0 : idx, 'jazz', idx > 0);

    const repaired = repairMeasure(written, { key, heldPitches: [], maxNotes: 10 });
    const completed = idx >= 0
      ? completeMelody(repaired.notes, { plan, key, motif: null, register: REGISTER, maxNotes: 10 })
      : { notes: repaired.notes };
    // THE ARC'S OWN OVERRIDES, in the room's order: a cadence bar is REPLACED, a restate bar is
    // replaced by the stored hook (no hook here, so it stands as the model wrote it).
    const arc = position === 'cadence'
      ? cadenceFrom(completed.notes, { key, register: REGISTER })
      : completed.notes;
    const led = idx === 0 ? leadInto(arc, { fromMidi: 67, key, register: REGISTER }) : arc;
    const contoured = applyContourRules(led, { key, register: REGISTER });
    const shaped = shapeLine(contoured, { contour: plan.contour, density: 'medium' });

    rows.push({
      bar: Number(meta.bar ?? 0),
      position,
      written: written.length,
      afterRepair: repaired.notes.length,
      afterComplete: completed.notes.length,
      afterArc: arc.length,
      afterContour: contoured.length,
      afterShape: shaped.length,
      planned: String(meta.plan ?? '').trim() === '(rest)' || !meta.plan ? 0 : String(meta.plan).split(' ').length,
    });
    const last = [...shaped].sort((a, b) => a.beatTime - b.beatTime).slice(0, 4)
      .map(n => `${n.pitch}@${n.beatTime.toFixed(2)}`).join(', ');
    if (last) motif = last;
  }

  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const head = 'bar        position  written  repair  complete  arc  contour  shape  planned';
  console.log(head);
  for (const r of rows) {
    console.log(
      String(r.bar).padEnd(10),
      r.position.padEnd(9),
      String(r.written).padStart(7),
      String(r.afterRepair).padStart(7),
      String(r.afterComplete).padStart(9),
      String(r.afterArc).padStart(4),
      String(r.afterContour).padStart(8),
      String(r.afterShape).padStart(6),
      String(r.planned).padStart(8),
    );
  }
  console.log(''.padEnd(90, '-'));
  console.log(
    'TOTAL'.padEnd(10), ''.padEnd(9),
    String(sum(r => r.written)).padStart(7),
    String(sum(r => r.afterRepair)).padStart(7),
    String(sum(r => r.afterComplete)).padStart(9),
    String(sum(r => r.afterArc)).padStart(4),
    String(sum(r => r.afterContour)).padStart(8),
    String(sum(r => r.afterShape)).padStart(6),
    String(sum(r => r.planned)).padStart(8),
  );
  const w = sum(r => r.written);
  const stages: Array<[string, number]> = [
    ['repair', sum(r => r.afterRepair)],
    ['complete', sum(r => r.afterComplete)],
    ['arc (cadence replaced)', sum(r => r.afterArc)],
    ['contour', sum(r => r.afterContour)],
    ['shapeLine', sum(r => r.afterShape)],
  ];
  console.log('');
  let prev = w;
  for (const [name, n] of stages) {
    console.log(`${name.padEnd(24)} ${String(n).padStart(4)}  (${n - prev >= 0 ? '+' : ''}${n - prev})`);
    prev = n;
  }
  console.log(`${'kept'.padEnd(24)} ${String(prev).padStart(4)} of ${w}  = ${Math.round((100 * prev) / w)}%`);
}

main().catch(err => { console.error(err); process.exit(1); });
