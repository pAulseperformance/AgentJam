import { describe, it, expect } from 'vitest';
import { drumBar, bassBar, countInBar, DRUM } from './groove';
import { pitchClassOf, scalePitchClasses, midiOf } from '@/shared/music';

const onGrid = (beatTime: number) => Math.abs(beatTime * 4 - Math.round(beatTime * 4)) < 1e-9;

describe('the drummer', () => {
  it('always hits the downbeat, in every style', () => {
    for (const style of ['jazz', 'funk', 'ambient', 'random'] as const) {
      for (let bar = 0; bar < 4; bar++) {
        const notes = drumBar(style, bar);
        expect(notes.length).toBeGreaterThan(0);
        // ambient is the one style allowed to skip the downbeat on odd bars
        if (style !== 'ambient') expect(notes.some(n => n.beatTime === 0)).toBe(true);
      }
    }
  });

  it('plays only drum codes, never a melodic pitch, and only on the grid', () => {
    const codes = new Set(Object.values(DRUM));
    for (const style of ['jazz', 'funk', 'ambient', 'random'] as const) {
      for (const n of drumBar(style, 3)) {
        expect(codes.has(n.pitch as typeof DRUM[keyof typeof DRUM])).toBe(true);
        expect(onGrid(n.beatTime)).toBe(true);
        expect(n.beatTime).toBeLessThan(4);
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
    }
  });

  it('is straight sixteenths in funk and swung offbeats in jazz', () => {
    const funk = drumBar('funk', 0).filter(n => n.pitch === DRUM.hat);
    const jazz = drumBar('jazz', 0).filter(n => n.pitch === DRUM.hat);

    expect(funk).toHaveLength(16);
    expect(jazz.map(n => n.beatTime)).toEqual([0, 1.5, 2, 3.5]);
  });

  it('does not change pattern between two calls for the same bar', () => {
    for (let bar = 0; bar < 5; bar++) {
      expect(drumBar('jazz', bar)).toEqual(drumBar('jazz', bar));
    }
  });

  it('counts the room in with four quarters', () => {
    const notes = countInBar('funk');
    expect(notes.filter(n => n.pitch !== DRUM.hat).map(n => n.beatTime)).toEqual([0, 1, 2, 3]);
  });
});

describe('the bass player', () => {
  it('plays in the key, in the low register, on the grid', () => {
    const allowed = new Set(scalePitchClasses('C major'));
    for (const style of ['jazz', 'funk', 'ambient', 'random'] as const) {
      for (const n of bassBar(style, 'C major', 4)) {
        const pc = pitchClassOf(n.pitch);
        expect(pc === null ? false : allowed.has(pc)).toBe(true);
        expect(midiOf(n.pitch) ?? 0).toBeLessThan(60); // below C4
        expect(onGrid(n.beatTime)).toBe(true);
      }
    }
  });

  it('starts on the root of the key', () => {
    for (const key of ['C major', 'A minor', 'G major']) {
      const first = bassBar('jazz', key, 0)[0];
      expect(first?.beatTime).toBe(0);
      expect(pitchClassOf(first!.pitch)).toBe(scalePitchClasses(key)[0]);
    }
  });

  it('moves on the back half in jazz rather than sitting still', () => {
    const notes = bassBar('jazz', 'C major', 0);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    expect(notes[1]?.beatTime).toBe(2);
  });
});
