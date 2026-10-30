/**
 * Music Theory & Pattern Generators
 *
 * Shared between:
 * - scripts/run-agent.ts (external agent)
 * - server/jam-room.ts (in-process agent spawning)
 */

// ─── Music Theory ────────────────────────────────────────────────────────────

/**
 * NOTE VELOCITIES ARE MIDI 1-127 EVERYWHERE. The generators used to emit 0.2-0.8 and the audio engine
 * divides by 127, so a pattern bar played at under one percent volume, which is why the fallback path
 * sounded like silence. One unit, on the wire and in the generator.
 */
const SCALES: Record<string, number[]> = {
  'C major':  [0, 2, 4, 5, 7, 9, 11],
  'C minor':  [0, 2, 3, 5, 7, 8, 10],
  'D major':  [2, 4, 6, 7, 9, 11, 1],
  'D minor':  [2, 4, 5, 7, 9, 10, 0],
  'E major':  [4, 6, 8, 9, 11, 1, 3],
  'E minor':  [4, 6, 7, 9, 11, 0, 2],
  'F major':  [5, 7, 9, 10, 0, 2, 4],
  'G major':  [7, 9, 11, 0, 2, 4, 6],
  'A major':  [9, 11, 1, 2, 4, 6, 8],
  'A minor':  [9, 11, 0, 2, 4, 5, 7],
  'B major':  [11, 1, 3, 4, 6, 8, 10],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function getScaleNotes(key: string, octaveRange: [number, number] = [3, 5]): string[] {
  const intervals = SCALES[key] ?? SCALES['C major']!;
  const notes: string[] = [];
  for (let oct = octaveRange[0]; oct <= octaveRange[1]; oct++) {
    for (const interval of intervals) {
      const midi = (oct + 1) * 12 + interval;
      notes.push(midiToNoteName(midi));
    }
  }
  return notes;
}


// ─── Key arithmetic ──────────────────────────────────────────────────────────
//
// Everything the room plays is in a key, so a pitch has to be placeable in it: the listener needs the
// open pitch classes, the repairer needs to move a stray note to the nearest one, and the diagnosis
// needs to say how much of a bar was outside the key.

const NATURAL_PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `C4` -> 0, `A#3` -> 10. Returns null for text that is not a pitch. */
export function pitchClassOf(pitch: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)?$/.exec(String(pitch).trim());
  if (!m) return null;
  const natural = NATURAL_PITCH_CLASS[m[1]!.toUpperCase()];
  if (natural === undefined) return null;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (((natural + accidental) % 12) + 12) % 12;
}

/** Absolute MIDI number for `C4` (60). Octave defaults to 4 when the pitch omits it. */
export function midiOf(pitch: string): number | null {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)?$/.exec(String(pitch).trim());
  if (!m) return null;
  const pc = pitchClassOf(pitch);
  if (pc === null) return null;
  const octave = m[3] ? Number(m[3]) : 4;
  // midi 60 is C4, so a pitch class below C sits in the next octave up at this octave number
  return (octave + 1) * 12 + pc;
}

export function noteNameFromMidi(midi: number): string {
  return midiToNoteName(Math.max(0, Math.min(127, Math.round(midi))));
}

/** The pitch classes the key allows, as numbers 0-11. */
export function scalePitchClasses(key: string): number[] {
  return SCALES[key] ?? SCALES['C major']!;
}

export function isInKey(pitch: string, key: string): boolean {
  const pc = pitchClassOf(pitch);
  return pc !== null && scalePitchClasses(key).includes(pc);
}

/**
 * The nearest pitch in the key, keeping the register: distance 0 first, then a semitone either way,
 * and never more than a whole tone away (a bigger move would rewrite the line instead of tidying it).
 */
export function snapPitchToKey(pitch: string, key: string): string {
  const midi = midiOf(pitch);
  if (midi === null) return pitch;
  const allowed = scalePitchClasses(key);
  // Flatter first: a stray sharp resolves down, which is what a player does with a note that
  // arrived on the wrong side of the key.
  for (const distance of [0, 1, 2]) {
    for (const dir of distance === 0 ? [0] : [-1, 1]) {
      const candidate = midi + dir * distance;
      const pc = ((candidate % 12) + 12) % 12;
      if (allowed.includes(pc)) return noteNameFromMidi(candidate);
    }
  }
  return pitch;
}

// ─── Pattern Generators ──────────────────────────────────────────────────────

export interface GeneratedNote {
  pitch: string;
  beatTime: number;
  velocity: number;
  duration: number;
}

export type AgentStyle = 'jazz' | 'ambient' | 'funk' | 'random';

/**
 * A LINE, NOT A LOTTERY. Every pattern used to pick a pitch with `Math.random() * scaleNotes.length`,
 * and measured live that produced `G3 B3 G5 C4 A4 D3 E5 C5 B5` in one bar: six leaps of an octave
 * inside a two-octave spread. A fallback bar is still heard by a person, so it walks the scale one or
 * two degrees at a time and turns around every four notes, which is the cheapest way to sound intended.
 */
function linePitches(scaleNotes: string[], count: number): string[] {
  if (scaleNotes.length === 0) return [];
  const out: string[] = [];
  let index = Math.floor(scaleNotes.length / 2);
  let direction = 1;
  for (let n = 0; n < count; n++) {
    out.push(scaleNotes[Math.max(0, Math.min(scaleNotes.length - 1, index))]!);
    index += direction * (1 + Math.floor(Math.random() * 2));
    if (index >= scaleNotes.length - 1) { index = scaleNotes.length - 1; direction = -1; }
    else if (index <= 0) { index = 0; direction = 1; }
    if (n % 4 === 3) direction = -direction;
  }
  return out;
}

function generateJazzPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 4 + Math.floor(Math.random() * 8);
  const line = linePitches(scaleNotes, numNotes);

  for (let i = 0; i < numNotes; i++) {
    const baseTime = (i / numNotes) * 4;
    const swing = i % 2 === 1 ? 0.08 : 0;
    const beatTime = Math.round((baseTime + swing) * 4) / 4;

    notes.push({
      pitch: line[i]!,
      beatTime: Math.min(beatTime, 3.75),
      velocity: 50 + Math.random() * 50,
      duration: 0.25 + Math.random() * 0.75,
    });
  }

  return notes;
}

function generateAmbientPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 2 + Math.floor(Math.random() * 4);
  const line = linePitches(scaleNotes, numNotes);

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: line[i]!,
      beatTime: Math.round(Math.random() * 3 * 4) / 4,
      velocity: 25 + Math.random() * 40,
      duration: 1.0 + Math.random() * 2.0,
    });
  }

  return notes;
}

function generateFunkPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const pattern = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0];
  const line = linePitches(scaleNotes, pattern.filter(Boolean).length);
  let at = 0;

  for (let i = 0; i < 16; i++) {
    if (pattern[i]) {
      notes.push({
        pitch: line[at++]!,
        beatTime: i * 0.25,
        velocity: i % 4 === 0 ? 105 : 60 + Math.random() * 30,
        duration: 0.125 + Math.random() * 0.125,
      });
    }
  }

  return notes;
}

function generateRandomPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 3 + Math.floor(Math.random() * 10);
  const line = linePitches(scaleNotes, numNotes);

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: line[i]!,
      beatTime: Math.round(Math.random() * 15) / 4,
      velocity: 40 + Math.random() * 60,
      duration: 0.125 + Math.random() * 1.0,
    });
  }

  return notes;
}

const GENERATORS: Record<AgentStyle, typeof generateJazzPattern> = {
  jazz: generateJazzPattern,
  ambient: generateAmbientPattern,
  funk: generateFunkPattern,
  random: generateRandomPattern,
};

/** Generate a measure's worth of notes for the given style and key */
export function generateMeasure(style: AgentStyle, key: string, bpm: number): GeneratedNote[] {
  const scaleNotes = getScaleNotes(key);
  const generator = GENERATORS[style] ?? generateJazzPattern;
  return generator(scaleNotes, bpm);
}
