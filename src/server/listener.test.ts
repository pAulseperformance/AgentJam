import { describe, it, expect } from 'vitest';
import { summarizePhrase, motifFrom, describePhrase, describeMotif, type NoteRecord } from './listener';

const BAR_MS = 2000;
const BEAT_MS = 500;

const on = (pitch: string, beat: number, extra: Partial<NoteRecord> = {}): NoteRecord => ({
  peerId: 'human', type: 'note_on', pitch, beatTime: beat, velocity: 90,
  timestamp: 1_000 + beat * BEAT_MS, duration: 0.5, ...extra,
});

const opts = { barStartMs: 1_000, barMs: BAR_MS, beatMs: BEAT_MS };

describe('the listener', () => {
  it('says nothing was played when the window is empty', () => {
    const phrase = summarizePhrase([], opts);
    expect(phrase.count).toBe(0);
    expect(phrase.contour).toBe('none');
    expect(describePhrase(phrase)).toContain('silent');
  });

  it('reads a rising line as rising', () => {
    const phrase = summarizePhrase([on('C4', 0), on('E4', 1), on('G4', 2), on('B4', 3)], opts);
    expect(phrase.contour).toBe('rising');
  });

  it('reads a falling line as falling', () => {
    const phrase = summarizePhrase([on('B4', 0), on('G4', 1), on('E4', 2), on('C4', 3)], opts);
    expect(phrase.contour).toBe('falling');
  });

  it('reads a line that goes up and back down as a wave, not a flat line', () => {
    const phrase = summarizePhrase([on('C4', 0), on('A4', 1), on('C4', 2), on('D4', 3)], opts);
    expect(phrase.contour).toBe('wave');
  });

  it('places the register by the median pitch', () => {
    expect(summarizePhrase([on('C3', 0), on('G3', 1), on('D3', 2)], opts).register).toBe('low');
    expect(summarizePhrase([on('C4', 0), on('G4', 1), on('E5', 2)], opts).register).toBe('mid');
    expect(summarizePhrase([on('C5', 0), on('G5', 1), on('E6', 2)], opts).register).toBe('high');
  });

  it('reads articulation from how long the notes are held', () => {
    expect(summarizePhrase([on('C4', 0, { duration: 0.25 })], opts).articulation).toBe('short');
    expect(summarizePhrase([on('C4', 0, { duration: 2 })], opts).articulation).toBe('long');
  });

  it('marks which sixteenths were used, so the prompt can name the room left open', () => {
    const phrase = summarizePhrase([on('C4', 0), on('E4', 1)], opts);
    expect(phrase.usedSlots[0]).toBe(true);
    expect(phrase.usedSlots[4]).toBe(true);
    expect(phrase.usedSlots[8]).toBe(false);
    expect(phrase.openSlots).toContain(8);
    expect(phrase.openSlots).not.toContain(0);
  });

  it('keeps the notes that landed on the strong beats, which is what a listener hears as the line', () => {
    const phrase = summarizePhrase([on('C4', 0), on('D4', 0.25), on('G4', 2)], opts);
    expect(phrase.strongBeatPitches).toEqual(['C4', 'G4']);
  });

  it('knows which pitches are still held', () => {
    const phrase = summarizePhrase([
      on('C4', 0),
      { peerId: 'human', type: 'note_on', pitch: 'G4', beatTime: 2, velocity: 90, timestamp: 2_000, duration: 1 },
      { peerId: 'human', type: 'note_off', pitch: 'C4', beatTime: 1, velocity: 0, timestamp: 1_500 },
    ], opts);

    expect(phrase.held).toEqual(['G4']);
  });

  it('carries the pitch classes and the last note, for the answer constraint', () => {
    const phrase = summarizePhrase([on('C4', 0), on('E4', 1), on('G4', 2)], opts);
    expect(phrase.pitchClasses.sort((a, b) => a - b)).toEqual([0, 4, 7]);
    expect(phrase.lastPitch).toBe('G4');
    expect(phrase.pitches).toEqual(['C4', 'E4', 'G4']);
  });
});

describe('motif memory', () => {
  it('keeps the agent own last bar as an idea it can develop', () => {
    const motif = motifFrom([
      { pitch: 'E4', beatTime: 0 },
      { pitch: 'G4', beatTime: 1 },
      { pitch: 'C5', beatTime: 2.5 },
    ]);
    expect(motif?.pitches).toEqual(['E4', 'G4', 'C5']);
    expect(motif?.slots).toEqual([0, 4, 10]);
    expect(describeMotif(motif)).toContain('C5@2.50');
  });

  it('caps the motif at four notes and returns nothing for a rest bar', () => {
    const long = motifFrom(Array.from({ length: 9 }, (_, i) => ({ pitch: 'C4', beatTime: i * 0.25 })));
    expect(long?.pitches).toHaveLength(4);
    expect(motifFrom([])).toBeNull();
    expect(describeMotif(null)).toContain('none yet');
  });
});
