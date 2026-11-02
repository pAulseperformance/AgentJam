import { describe, expect, it } from 'vitest';
import { KEY_MAP, blackKeySeams, describePitch, inKey, letterFor, mappedPitches, whitePitches } from './keyboard-layout';

/**
 * THE PIANO'S OWN DATA. Three readings a person needs and could not see: which letter plays a note, which
 * notes are in the room's key, and what a note is called when it lands.
 */
describe('the computer keyboard as an instrument', () => {
  it('answers the letter that plays a pitch, and nothing for a pitch no key reaches', () => {
    expect(letterFor('C4')).toBe('A');
    expect(letterFor('F#4')).toBe('5');
    expect(letterFor('C2')).toBe('');
    // Every mapped pitch round-trips through its own letter.
    for (const pitch of mappedPitches()) {
      const letter = letterFor(pitch).toLowerCase();
      expect(KEY_MAP[letter], `${pitch} via ${letter}`).toBe(pitch);
    }
  });

  it('separates the room key from the notes outside it', () => {
    expect(inKey('C4', 'C major')).toBe(true);
    expect(inKey('F#4', 'C major')).toBe(false);
    expect(inKey('Bb4', 'C major')).toBe(false);
    // A minor shares its pitch classes with C major, so the same notes read as in key.
    expect(inKey('A4', 'A minor')).toBe(true);
    expect(inKey('C#4', 'A minor')).toBe(false);
  });

  it('does not grey out a piano in a room with no key set', () => {
    expect(inKey('F#4', undefined)).toBe(true);
    expect(inKey('B5', 'not a key')).toBe(true);
  });

  it('lays out a piano: a continuous white strip and black keys on the right seams', () => {
    const octaves = [3, 4, 5];
    const whites = whitePitches(octaves);
    expect(whites.length).toBe(21);
    expect(whites[0]).toBe('C3');
    expect(whites[6]).toBe('B3');
    expect(whites[7]).toBe('C4');

    const blacks = blackKeySeams(octaves);
    expect(blacks.length).toBe(15);
    // No black key between E and F or B and C: those seams are 3 and 7 within an octave.
    const withinOctave = blacks.map(entry => entry.seam % 7);
    expect(withinOctave).not.toContain(3);
    expect(withinOctave).not.toContain(0);
    expect(new Set(withinOctave).size).toBe(5);
    // Every seam is a real boundary between two white keys, and the pitch names the right one.
    for (const entry of blacks) {
      expect(entry.seam).toBeGreaterThan(0);
      expect(entry.seam).toBeLessThan(whites.length);
    }
    expect(blacks.find(entry => entry.pitch === 'C#3')?.seam).toBe(1);
    expect(blacks.find(entry => entry.pitch === 'A#5')?.seam).toBe(20);
  });

  it('describes a landed note with its letter and whether it fits', () => {
    expect(describePitch('C4', 'C major')).toBe('C4 · in key · key A');
    // No key on the QWERTY map reaches F#5, so the description names no letter rather than inventing one.
    expect(describePitch('F#5', 'C major')).toBe('F#5 · outside');
    expect(describePitch('C2', 'C major')).toBe('C2 · in key');
  });
});
