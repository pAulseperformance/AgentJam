import { describe, it, expect } from 'vitest';
import { repairMeasure } from './measure-repair';
import { pitchClassOf, type GeneratedNote } from '@/shared/music';

const note = (pitch: string, beatTime: number, velocity = 90, duration = 0.5): GeneratedNote =>
  ({ pitch, beatTime, velocity, duration });

describe('repairMeasure', () => {
  it('puts every note on the sixteenth grid', () => {
    const { notes, dropped } = repairMeasure(
      [note('E4', 0.37), note('G4', 1.12), note('C4', 2.6)],
      { key: 'C major' },
    );

    expect(notes.map(n => n.beatTime)).toEqual([0.25, 1, 2.5]);
    expect(dropped.offGrid).toBe(3);
  });

  it('moves an out-of-key note to the nearest pitch in the key, keeping the register', () => {
    const { notes, dropped } = repairMeasure(
      [note('F#4', 0), note('D#4', 1), note('G#4', 2)],
      { key: 'C major' },
    );

    expect(notes.map(n => n.pitch)).toEqual(['F4', 'D4', 'G4']);
    expect(dropped.outOfKey).toBe(3);
    // every surviving pitch is now in the key
    for (const n of notes) expect(['F4', 'D4', 'G4']).toContain(n.pitch);
  });

  // MEASURED ON THE LIVE ROUTE: llama-3.2-3b answered with `Am4`, a chord name, not a pitch.
  it('drops a pitch the synth could not play', () => {
    const { notes, dropped } = repairMeasure(
      [note('Am4', 0), note('E4/E5', 1), note('C4', 2)],
      { key: 'C major' },
    );
    expect(notes.map(n => n.pitch)).toEqual(['C4']);
    expect(dropped.invalid).toBe(2);
  });

  it('drops a note someone else is holding instead of transposing it', () => {
    const { notes, dropped } = repairMeasure(
      [note('E4', 0), note('G4', 1)],
      { key: 'C major', heldPitches: ['E4'] },
    );

    expect(notes.map(n => n.pitch)).toEqual(['G4']);
    expect(dropped.unison).toBe(1);
  });

  it('drops a note that would snap onto a held pitch', () => {
    const { notes, dropped } = repairMeasure([note('F#4', 0)], { key: 'C major', heldPitches: ['F4'] });
    expect(notes).toHaveLength(0);
    expect(dropped.unison).toBe(1);
  });

  it('keeps one note per pitch per grid slot, in time order', () => {
    const { notes, dropped } = repairMeasure(
      [note('C4', 2), note('E4', 0), note('C4', 2)],
      { key: 'C major' },
    );

    expect(notes.map(n => `${n.pitch}@${n.beatTime}`)).toEqual(['E4@0', 'C4@2']);
    expect(dropped.duplicate).toBe(1);
  });

  it('caps density from the front, so a crowded bar loses its tail and not its downbeat', () => {
    const crowded = Array.from({ length: 14 }, (_, i) => note('C4', i * 0.25, 90, 0.25));
    const { notes, dropped } = repairMeasure(crowded, { key: 'C major', maxNotes: 8 });

    // 14 slots, all C4, so the duplicate pass keeps 14 distinct slots then the cap keeps the first 8
    expect(notes).toHaveLength(8);
    expect(notes.at(-1)?.beatTime).toBe(1.75);
    expect(dropped.overCap).toBeGreaterThan(0);
  });

  it('normalizes a 0-1 velocity from an older generator to MIDI', () => {
    expect(repairMeasure([note('C4', 0, 0.8)], { key: 'C major' }).notes[0]?.velocity).toBe(102);
    expect(repairMeasure([note('C4', 0, 90)], { key: 'C major' }).notes[0]?.velocity).toBe(90);
  });

  it('leaves an already-clean bar untouched', () => {
    const clean = [note('C4', 0, 100, 1), note('E4', 1, 90, 1), note('G4', 2, 80, 1)];
    const { notes, dropped } = repairMeasure(clean, { key: 'C major' });

    expect(notes).toEqual(clean);
    expect(dropped).toEqual({ rescaled: 0, invalid: 0, offGrid: 0, outOfKey: 0, unison: 0, duplicate: 0, overCap: 0 });
  });

  describe('when the bar is an answer', () => {
    it('leaves a bar that already shares a pitch class alone', () => {
      const { notes, answered } = repairMeasure(
        [note('C4', 0), note('G4', 2)],
        { key: 'C major', answerPitches: ['E4', 'G4'] },
      );
      expect(answered).toBe(true);
      expect(notes.map(n => n.pitch)).toEqual(['C4', 'G4']);
    });

    it('moves one note onto their pitch class when the bar shares nothing at all', () => {
      const { notes, answered } = repairMeasure(
        [note('C4', 0), note('D4', 1), note('E4', 2)],
        { key: 'C major', answerPitches: ['F4', 'A4'] },
      );
      expect(answered).toBe(true);
      expect(notes.some(n => [5, 9].includes(pitchClassOf(n.pitch) ?? -1))).toBe(true);
      // only one note moved: an answer is a gesture, not a rewrite
      expect(notes.filter(n => n.pitch !== 'C4' && n.pitch !== 'D4' && n.pitch !== 'E4')).toHaveLength(1);
    });

    it('answers in the register of the phrase rather than jumping octaves', () => {
      const { notes } = repairMeasure(
        [note('C4', 0), note('D4', 1), note('E4', 2), note('F4', 3)],
        { key: 'C major', answerPitches: ['A3'] },
      );
      const moved = notes.find(n => n.pitch !== 'C4' && n.pitch !== 'D4' && n.pitch !== 'E4' && n.pitch !== 'F4');
      expect(moved?.pitch).toBe('A3');
    });
  });

  describe('playing at the room level', () => {
    it('lifts a soft bar to a loud room', () => {
      const { notes, dropped } = repairMeasure(
        [note('C4', 0, 40, 0.5), note('E4', 1, 45, 0.5)],
        { key: 'C major', targetMeanVelocity: 110 },
      );
      const mean = notes.reduce((s, n) => s + n.velocity, 0) / notes.length;
      expect(mean).toBeGreaterThan(85);
      expect(dropped.rescaled).toBe(2);
    });

    it('brings a loud bar down for a quiet room', () => {
      const { notes } = repairMeasure(
        [note('C4', 0, 120, 0.5), note('G4', 2, 125, 0.5)],
        { key: 'C major', targetMeanVelocity: 45 },
      );
      const mean = notes.reduce((s, n) => s + n.velocity, 0) / notes.length;
      expect(mean).toBeLessThan(80);
    });

    it('leaves a bar that already plays at their level untouched', () => {
      const { notes, dropped } = repairMeasure(
        [note('C4', 0, 88, 0.5), note('E4', 1, 92, 0.5)],
        { key: 'C major', targetMeanVelocity: 90 },
      );
      expect(notes.map(n => n.velocity)).toEqual([88, 92]);
      expect(dropped.rescaled).toBe(0);
    });

    it('never scales a velocity out of the MIDI range', () => {
      const { notes } = repairMeasure(
        [note('C4', 0, 127, 0.5), note('E4', 1, 126, 0.5)],
        { key: 'C major', targetMeanVelocity: 20 },
      );
      for (const n of notes) {
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
    });
  });

  it('handles a rest bar (no notes) without inventing any', () => {
    const { notes } = repairMeasure([], { key: 'C major' });
    expect(notes).toHaveLength(0);
  });
});
