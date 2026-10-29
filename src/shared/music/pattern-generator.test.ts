import { describe, it, expect } from 'vitest';
import {
  generateMeasure,
  getScaleNotes,
  pitchClassOf,
  scalePitchClasses,
  snapPitchToKey,
  isInKey,
} from './pattern-generator';

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

    // MIDI 1-127 on the wire. The generator used to emit 0.2-0.8 while the audio engine divides by
    // 127, so a pattern bar played at under one percent volume.
    it('generates notes with a MIDI velocity (1-127)', () => {
      for (const style of ['jazz', 'ambient', 'funk', 'random'] as const) {
        const notes = generateMeasure(style, 'C major', 120);
        for (const note of notes) {
          expect(note.velocity).toBeGreaterThanOrEqual(1);
          expect(note.velocity).toBeLessThanOrEqual(127);
        }
      }
    });

    it('generates notes with valid duration (>0)', () => {
      const notes = generateMeasure('jazz', 'C major', 120);
      for (const note of notes) {
        expect(note.duration).toBeGreaterThan(0);
      }
    });
  });

  describe('key arithmetic', () => {
    it('reads the pitch class of a note name, accidentals included', () => {
      expect(pitchClassOf('C4')).toBe(0);
      expect(pitchClassOf('D#4')).toBe(3);
      expect(pitchClassOf('Bb3')).toBe(10);
      expect(pitchClassOf('not-a-note')).toBeNull();
    });

    it('knows which pitch classes a key allows', () => {
      expect(scalePitchClasses('C major').sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
      expect(scalePitchClasses('A minor').sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
      expect(scalePitchClasses('unknown key').sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    });

    it('moves a stray pitch to the nearest one in the key, keeping its register', () => {
      // F#4 is not in C major; F4 and G4 are both a semitone away, the flat wins (lower first)
      expect(snapPitchToKey('F#4', 'C major')).toBe('F4');
      // D#4 (pc 3) sits between D4 (2) and E4 (4)
      expect(snapPitchToKey('D#4', 'C major')).toBe('D4');
      // already in key: untouched
      expect(snapPitchToKey('G4', 'C major')).toBe('G4');
      // in A minor, G# is out and G is in
      expect(snapPitchToKey('G#4', 'A minor')).toBe('G4');
    });

    it('answers isInKey for the accepted spellings', () => {
      expect(isInKey('E4', 'C major')).toBe(true);
      expect(isInKey('D#4', 'C major')).toBe(false);
      expect(isInKey('D#4', 'E major')).toBe(true);
    });
  });
});
