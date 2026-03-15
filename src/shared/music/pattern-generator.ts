/**
 * Music Theory & Pattern Generators
 *
 * Shared between:
 * - scripts/run-agent.ts (external agent)
 * - server/jam-room.ts (in-process agent spawning)
 */

// ─── Music Theory ────────────────────────────────────────────────────────────

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

// ─── Pattern Generators ──────────────────────────────────────────────────────

export interface GeneratedNote {
  pitch: string;
  beatTime: number;
  velocity: number;
  duration: number;
}

export type AgentStyle = 'jazz' | 'ambient' | 'funk' | 'random';

function generateJazzPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 4 + Math.floor(Math.random() * 8);

  for (let i = 0; i < numNotes; i++) {
    const baseTime = (i / numNotes) * 4;
    const swing = i % 2 === 1 ? 0.08 : 0;
    const beatTime = Math.round((baseTime + swing) * 4) / 4;

    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.min(beatTime, 3.75),
      velocity: 0.4 + Math.random() * 0.4,
      duration: 0.25 + Math.random() * 0.75,
    });
  }

  return notes;
}

function generateAmbientPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 2 + Math.floor(Math.random() * 4);

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.round(Math.random() * 3 * 4) / 4,
      velocity: 0.2 + Math.random() * 0.3,
      duration: 1.0 + Math.random() * 2.0,
    });
  }

  return notes;
}

function generateFunkPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const pattern = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0];

  for (let i = 0; i < 16; i++) {
    if (pattern[i]) {
      notes.push({
        pitch: scaleNotes[Math.floor(Math.random() * Math.min(5, scaleNotes.length))]!,
        beatTime: i * 0.25,
        velocity: i % 4 === 0 ? 0.8 : 0.5 + Math.random() * 0.2,
        duration: 0.125 + Math.random() * 0.125,
      });
    }
  }

  return notes;
}

function generateRandomPattern(scaleNotes: string[], _bpm: number): GeneratedNote[] {
  const notes: GeneratedNote[] = [];
  const numNotes = 3 + Math.floor(Math.random() * 10);

  for (let i = 0; i < numNotes; i++) {
    notes.push({
      pitch: scaleNotes[Math.floor(Math.random() * scaleNotes.length)]!,
      beatTime: Math.round(Math.random() * 15) / 4,
      velocity: 0.3 + Math.random() * 0.5,
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
