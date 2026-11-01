/**
 * A DIFFERENT INSTRUMENT FOR THE SAME QUESTION.
 *
 * `tools/phrase-apply.ts` answers "what would the room play" by replaying a stored model answer through
 * a copy of the room's passes. This reads what the room ACTUALLY played: the note events on the wire,
 * grouped into bars by the only thing the wire gives you, a beatTime that goes backwards at a bar line.
 * Nothing here knows about the pipeline, the prompts or the arc.
 *
 *   npx tsx tools/wire-shape.ts --in /tmp/arc190d.json
 */

const IN = argOf('--in') ?? '';
const KEY = 'C minor';

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const SEMI: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
const midiOf = (pitch: string): number | null => {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(pitch);
  return m ? SEMI[m[1]!]! + 12 * (Number(m[2]) + 1) : null;
};

/** The drums, so a kit's C2/A5 figure is not read as a melody. */
const DRUM_PITCHES = new Set(['C2', 'D3', 'A5', 'G2']);

async function main() {
  const fs = await import('node:fs');
  const d = JSON.parse(fs.readFileSync(IN, 'utf8')) as {
    bpm: number;
    messages: Array<{ type: string; t: number; data: Record<string, unknown> }>;
  };

  // THE NOTES, AS THEY WENT ON THE WIRE, per peer.
  const byPeer = new Map<string, Array<{ t: number; pitch: string; beat: number }>>();
  for (const m of d.messages) {
    if (m.type !== 'note_on') continue;
    const ev = m.data as { peerId?: string; pitch?: string; beatTime?: number };
    if (!ev.peerId || !ev.pitch) continue;
    const rows = byPeer.get(ev.peerId) ?? [];
    rows.push({ t: m.t, pitch: ev.pitch, beat: Number(ev.beatTime ?? 0) });
    byPeer.set(ev.peerId, rows);
  }

  let totals = { bars: 0, notes: 0, iv: 0, step: 0, rep: 0, leap: 0, endsStable: 0, line: 0 };
  for (const [peer, rows] of byPeer) {
    // A DRUM KIT IS NOT A MELODY: skip a peer whose notes are mostly kit pitches.
    const kitShare = rows.filter(r => DRUM_PITCHES.has(r.pitch)).length / Math.max(1, rows.length);
    if (kitShare > 0.5) {
      console.log(`peer ${peer.slice(0, 8)}  ${rows.length} notes  skipped: ${Math.round(kitShare * 100)}% are kit pitches`);
      continue;
    }
    rows.sort((a, b) => a.t - b.t);
    // A BAR STARTS WHERE beatTime GOES BACKWARDS. That is the only bar line the wire carries.
    const bars: Array<Array<{ t: number; pitch: string; beat: number }>> = [[]];
    let previous = -1;
    for (const r of rows) {
      if (previous >= 0 && r.beat < previous - 1e-9) bars.push([]);
      bars[bars.length - 1]!.push(r);
      previous = r.beat;
    }
    const intervals: number[] = [];
    let endsStable = 0;
    let line = 0;
    for (const bar of bars) {
      if (bar.length >= 4) line++;
      for (let i = 1; i < bar.length; i++) {
        const a = midiOf(bar[i - 1]!.pitch); const b = midiOf(bar[i]!.pitch);
        if (a !== null && b !== null) intervals.push(Math.abs(b - a));
      }
      const last = midiOf(bar.at(-1)!.pitch);
      if (last !== null && [0, 3, 7].includes(((last % 12) + 12) % 12)) endsStable++;
    }
    const step = intervals.filter(x => x >= 1 && x <= 2).length;
    const rep = intervals.filter(x => x === 0).length;
    const leap = intervals.filter(x => x >= 5).length;
    console.log(
      `peer ${peer.slice(0, 8)}  ${String(bars.length).padStart(3)} bars  ${String(rows.length).padStart(4)} notes` +
      `  ${(rows.length / bars.length).toFixed(1)}/bar  line ${line}/${bars.length}` +
      `  step ${Math.round((100 * step) / Math.max(1, intervals.length))}%` +
      `  rep ${Math.round((100 * rep) / Math.max(1, intervals.length))}%` +
      `  leap ${Math.round((100 * leap) / Math.max(1, intervals.length))}%` +
      `  ends C/Eb/G ${endsStable}/${bars.length}`,
    );
    totals = {
      bars: totals.bars + bars.length, notes: totals.notes + rows.length,
      iv: totals.iv + intervals.length, step: totals.step + step, rep: totals.rep + rep,
      leap: totals.leap + leap, endsStable: totals.endsStable + endsStable, line: totals.line + line,
    };
  }
  if (totals.bars > 0) {
    console.log(
      `ALL MELODIC  ${totals.bars} bars  ${totals.notes} notes  ${(totals.notes / totals.bars).toFixed(1)}/bar` +
      `  line ${totals.line}/${totals.bars}  step ${Math.round((100 * totals.step) / Math.max(1, totals.iv))}%` +
      `  rep ${Math.round((100 * totals.rep) / Math.max(1, totals.iv))}%` +
      `  leap ${Math.round((100 * totals.leap) / Math.max(1, totals.iv))}%` +
      `  ends C/Eb/G ${totals.endsStable}/${totals.bars}`,
    );
  }
  console.log(`key assumed ${KEY} (the room's own key is in the file header, not on the wire)`);
}

main().catch(err => { console.error(err); process.exit(1); });
