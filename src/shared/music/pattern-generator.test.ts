import { describe, it, expect } from 'vitest';
import { getScaleNotes, generateMeasure } from './pattern-generator';

describe('Pattern Generator & Music Theory', () => {
  describe('getScaleNotes', () => {
    it('returns correct pitches for C major', () => {
      const notes = getScaleNotes('C major', [4, 4]);
      expect(notes).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
    });

    it('returns notes within specified octave range', () => {
      const notes = getScaleNotes('A minor', [3, 4]);
      // Should contain 3rd and 4th octave notes
      expect(notes.some(n => n.endsWith('3'))).toBe(true);
      expect(notes.some(n => n.endsWith('4'))).toBe(true);
      expect(notes.some(n => n.endsWith('5'))).toBe(false);
    });

    it('falls back to C major for unknown key', () => {
      const valid = getScaleNotes('C major', [4, 4]);
      const unknown = getScaleNotes('H minor', [4, 4]);
      expect(unknown).toEqual(valid);
    });
  });

  describe('generateMeasure', () => {
    it('returns 4-12 notes for jazz style', () => {
      const notes = generateMeasure('jazz', 'C major', 120);
      expect(notes.length).toBeGreaterThanOrEqual(4);
      expect(notes.length).toBeLessThanOrEqual(12);
    });

    it('returns 2-6 notes for ambient style', () => {
      const notes = generateMeasure('ambient', 'C major', 80);
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(notes.length).toBeLessThanOrEqual(6);
    });

    it('returns notes on 16th note grid for funk style', () => {
      const notes = generateMeasure('funk', 'C major', 110);
      for (const note of notes) {
        // beatTime should be a multiple of 0.25
        expect(note.beatTime % 0.25).toBe(0);
      }
    });

    it('generates notes with valid beatTime (0 to 3.99)', () => {
      const styles = ['jazz', 'ambient', 'funk', 'random'] as const;
      for (const style of styles) {
        const notes = generateMeasure(style, 'D minor', 100);
        for (const note of notes) {
          expect(note.beatTime).toBeGreaterThanOrEqual(0);
          expect(note.beatTime).toBeLessThan(4.0); // measure is 4 beats
        }
      }
    });

    it('generates notes with valid velocity (>0)', () => {
      const notes = generateMeasure('jazz', 'C major', 120);
      for (const note of notes) {
        expect(note.velocity).toBeGreaterThan(0);
        expect(note.velocity).toBeLessThanOrEqual(1.0); // using 0-1 range internally it seems
      }
    });

    it('generates notes with valid duration (>0)', () => {
      const notes = generateMeasure('jazz', 'C major', 120);
      for (const note of notes) {
        expect(note.duration).toBeGreaterThan(0);
      }
    });
  });
});
