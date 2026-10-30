import { describe, it, expect } from 'vitest';
import { melodyPlan, completeMelody } from './melody';
import { midiOf, isInKey } from '../shared/music/pattern-generator';

const note = (pitch: string, beatTime: number, velocity = 80, duration = 0.25) => ({ pitch, beatTime, velocity, duration });

describe('melodyPlan', () => {
  it('walks a four bar arc: state, restate, develop, cadence', () => {
    expect(melodyPlan(0, 'jazz', false).position).toBe('state');
    expect(melodyPlan(1, 'jazz', true).position).toBe('restate');
    expect(melodyPlan(2, 'jazz', true).position).toBe('develop');
    expect(melodyPlan(3, 'jazz', true).position).toBe('cadence');
    // the fifth bar is the first bar of the next phrase
    expect(melodyPlan(4, 'jazz', true).position).toBe('state');
  });

  it('asks for a line of at least five notes in every style', () => {
    for (const style of ['ambient', 'funk', 'jazz', 'random']) {
      for (let bar = 0; bar < 4; bar++) {
        const plan = melodyPlan(bar, style, bar > 0);
        expect(plan.wantNotes).toBeGreaterThanOrEqual(5);
        expect(plan.instruction).toContain('MELODY');
      }
    }
  });

  it('uses a wave for a develop bar that has a motif to develop', () => {
    expect(melodyPlan(2, 'jazz', true).contour).toBe('wave');
    expect(melodyPlan(2, 'jazz', false).contour).toBe('rising');
  });
});

describe('completeMelody', () => {
  const plan = melodyPlan(0, 'jazz', false); // 6 notes, arch, first statement

  it('completes a triad into a line instead of leaving three chord tones', () => {
    // the exact bar measured live: E4 C4 G4, an arpeggio, twice in a row
    const { notes, completed, added } = completeMelody(
      [note('E4', 0), note('C4', 1), note('G4', 2)],
      { plan, key: 'C major', motif: null, register: { low: 55, high: 72 } },
    );

    expect(completed).toBe(true);
    expect(added).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThanOrEqual(plan.wantNotes);
    expect(notes.every(n => isInKey(n.pitch, 'C major'))).toBe(true);
    expect(notes.every(n => {
      const m = midiOf(n.pitch);
      return m !== null && m >= 55 && m <= 72;
    })).toBe(true);

    // in time order, and most moves are steps: a line, not a chord
    const midis = notes.map(n => midiOf(n.pitch)!);
    let steps = 0;
    for (let i = 1; i < midis.length; i++) if (Math.abs(midis[i]! - midis[i - 1]!) <= 2) steps++;
    expect(steps / Math.max(1, midis.length - 1)).toBeGreaterThan(0.5);
  });

  it('leaves a bar that is already a line alone', () => {
    const line = [note('C4', 0), note('D4', 0.25), note('E4', 0.5), note('F4', 1), note('G4', 1.5), note('A4', 2)];
    const { notes, completed } = completeMelody(line, {
      plan,
      key: 'C major',
      motif: null,
      register: { low: 55, high: 72 },
    });

    expect(completed).toBe(false);
    expect(notes).toEqual(line);
  });

  it('keeps the motif rhythm on a restate instead of inventing a new one', () => {
    const restate = melodyPlan(1, 'jazz', true);
    const motif = { pitches: ['C4', 'E4', 'G4'], slots: [0, 4, 8] };
    const { notes, completed } = completeMelody([note('C4', 0)], {
      plan: restate,
      key: 'C major',
      motif,
      register: { low: 55, high: 72 },
    });

    expect(completed).toBe(true);
    const addedSlots = notes.map(n => Math.round(n.beatTime * 4));
    expect(addedSlots).toContain(4);
    expect(addedSlots).toContain(8);
  });

  it('never exceeds the note ceiling', () => {
    const { notes } = completeMelody([], {
      plan: melodyPlan(2, 'funk', true),
      key: 'C major',
      motif: null,
      register: { low: 55, high: 72 },
      maxNotes: 10,
    });
    expect(notes.length).toBeLessThanOrEqual(10);
    expect(notes.length).toBeGreaterThanOrEqual(5);
  });
});
