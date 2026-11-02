/**
 * THE COMPUTER KEYBOARD IS AN INSTRUMENT, and these are its strings.
 *
 * Three things used to be missing from it: a person could not see WHICH key they had hit, could not see
 * which notes belong to the room's key, and could not see which letters play which notes. All three are
 * the same data read three ways, so it lives here rather than inside the component.
 */
import { scalePitchClasses } from '@/shared/music';

/** Letter (or digit) to pitch. The A row is the home octave, because that is where the hands are. */
export const KEY_MAP: Record<string, string> = {
  z: 'C3', x: 'D3', c: 'E3', v: 'F3', b: 'G3', n: 'A3', m: 'B3',
  a: 'C4', s: 'D4', d: 'E4', f: 'F4', g: 'G4', h: 'A4', j: 'B4',
  q: 'C5', w: 'D5', e: 'E5', r: 'F5', t: 'G5', y: 'A5', u: 'B5',
  '2': 'C#4', '3': 'D#4', '5': 'F#4', '6': 'G#4', '7': 'A#4',
};

/** The reverse map, built once: a pitch answers the key a person would press for it. */
const LETTER_BY_PITCH = new Map<string, string>(
  Object.entries(KEY_MAP).map(([letter, pitch]) => [pitch, letter.toUpperCase()]),
);

/** The letter that plays a pitch, or an empty string when no key does. */
export function letterFor(pitch: string): string {
  return LETTER_BY_PITCH.get(pitch) ?? '';
}

/**
 * THE BOARD'S GEOMETRY, as data, because a piano is not seven buttons and some gaps.
 *
 * The white keys are one continuous strip. A black key sits ASTRIDE THE SEAM between two white keys, and
 * there is no black key between E and F or between B and C: the seams it may use are 1, 2, 4, 5 and 6
 * within an octave, counted in white keys from that octave's C.
 */
export const WHITE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** The white keys of a board, left to right. */
export function whitePitches(octaves: readonly number[]): string[] {
  return octaves.flatMap(octave => WHITE_NAMES.map(name => `${name}${octave}`));
}

/** Each black key with the seam it straddles, in white keys from the left of the whole board. */
export function blackKeySeams(octaves: readonly number[]): { pitch: string; seam: number }[] {
  const perOctave: [string, number][] = [['C#', 1], ['D#', 2], ['F#', 4], ['G#', 5], ['A#', 6]];
  return octaves.flatMap((octave, index) =>
    perOctave.map(([name, seam]) => ({ pitch: `${name}${octave}`, seam: index * WHITE_NAMES.length + seam })),
  );
}

/** Every pitch the computer keyboard can reach, for drawing labels. */
export function mappedPitches(): string[] {
  return [...LETTER_BY_PITCH.keys()];
}

/**
 * Whether a pitch belongs to the room's key. This is the harmonic helper: a person playing by eye should
 * see which keys are in and which are outside, because "play in the key" is advice until it is drawn.
 * An unreadable key answers true rather than false, so a room with no key set does not grey out the piano.
 */
export function inKey(pitch: string, key: string | undefined): boolean {
  if (!key) return true;
  const classes = new Set<number>(scalePitchClasses(key));
  if (classes.size === 0) return true;
  // A FLAT IS A PITCH CLASS, not a letter: "Bb4" used to read as B and land in C major, which is one
  // semitone wrong and exactly the note a beginner plays by mistake.
  const match = pitch.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!match) return true;
  const names: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = names[match[1]!];
  if (base === undefined) return true;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return classes.has(((base + accidental) % 12 + 12) % 12);
}

/** What to print beside a note: its letter, whether it is in the key, and the degree it plays. */
export function describePitch(pitch: string, key: string | undefined): string {
  const letter = letterFor(pitch);
  const where = inKey(pitch, key) ? 'in key' : 'outside';
  return letter ? `${pitch} · ${where} · key ${letter}` : `${pitch} · ${where}`;
}
