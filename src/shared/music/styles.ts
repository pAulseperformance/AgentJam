/**
 * THE STYLE REGISTRY: one row says what a style MEANS.
 *
 * Before this file, adding a genre meant editing a switch in the groove, a branch in the melody plan,
 * a branch in the cell shape, a glossary line in the prompt, a protocol enum, the spawn form and about
 * sixty test literals. A row here is read by all of them, so a new style is a row and a generator, and
 * the four existing rows reproduce the numbers the switches held: this file is an extraction first.
 *
 * Every field is a NUMBER or a WORD the model can be held to, not an adjective. The probe in
 * tools/style-probe.mjs counts notes per bar and onsets on the grid per row, so two rows that measure
 * the same distribution are a rename wearing a label.
 */

import type { InstrumentId } from './instruments';

/** The styles the room ships. Derived from the table below, never retyped. */
/** The four deterministic patterns the room can fill a bar from. */
export type GeneratorId = 'jazz' | 'ambient' | 'funk' | 'random';

export type AgentStyleId =
  | 'jazz'
  | 'funk'
  | 'ambient'
  | 'latin'
  | 'afrobeat'
  | 'house'
  | 'lofi'
  | 'cinematic'
  | 'random';

/** One hit in the kit. A repeat expands to a run of hits on the same voice. */
export interface DrumHit {
  voice: 'kick' | 'snare' | 'hat' | 'tom';
  beat: number;
  velocity: number;
  duration?: number;
  /** Play every bar (the default), or only the even or odd numbered ones. */
  bars?: 'every' | 'even' | 'odd';
  /** The beat this run stops before, stepping by `repeatStep`. `beat` is where it starts. */
  repeatTo?: number;
  repeatStep?: number;
  /** A fill that lands on some bars: the chance it plays, and the salt that makes it deterministic. */
  chance?: number;
  salt?: number;
}

/** One hit in the low end. `degree` is a scale degree, so the same row works in any key. */
export interface BassHit {
  degree: 'root' | 'fifth' | 'seventh';
  beat: number;
  velocity: number;
  duration?: number;
  bars?: 'every' | 'even' | 'odd';
}

/** What the model is told the style MEANS, and what the room holds it to. */
export interface StyleRow {
  id: AgentStyleId;
  label: string;
  icon: string;
  /** The model's own words for this style, printed in the prompt header. */
  verbs: string;
  /** Notes per bar: the statement, the development, the cadence, and the floor for any bar. */
  notes: { state: number; develop: number; cadence: number; fewest: number };
  /** Whether the bar is asked for as a riff with space around it, or as a melodic line. */
  verbStyle: 'riff' | 'melody';
  drums: DrumHit[];
  bass: BassHit[];
  /** The room's own figure for a bar the agent did not write. */
  cell: { notesPerCell: number; duration: number };
  /** The band the model's velocities are held inside. */
  velocity: { min: number; max: number };
  grid: 'eighth' | 'offbeat' | 'sixteenth';
  tempo: { min: number; max: number };
  /** The deterministic generator a late model falls back to: one of the four base patterns. */
  generator: GeneratorId;
  /** The voice a bot in this style is born with. */
  instrument: InstrumentId;
  /** A style that rotates through others by bar rather than having a shape of its own. */
  rotates?: AgentStyleId[];
}

const VELOCITY = { kick: 100, snare: 88, hat: 58, tom: 92 } as const;

export const STYLE_ROWS: readonly StyleRow[] = [
  {
    id: 'jazz',
    label: 'Jazz',
    icon: '🎷',
    verbs: 'swing, seventh chords, a walking line, comp lightly behind whoever has the tune',
    notes: { state: 6, develop: 7, cadence: 3, fewest: 5 },
    verbStyle: 'melody',
    drums: [
      { voice: 'kick', beat: 0, velocity: VELOCITY.kick },
      { voice: 'snare', beat: 2, velocity: VELOCITY.snare },
      { voice: 'hat', beat: 0, velocity: VELOCITY.hat, duration: 0.2 },
      { voice: 'hat', beat: 1.5, velocity: VELOCITY.hat, duration: 0.2 },
      { voice: 'hat', beat: 2, velocity: VELOCITY.hat, duration: 0.2 },
      { voice: 'hat', beat: 3.5, velocity: VELOCITY.hat, duration: 0.2 },
      { voice: 'snare', beat: 3.5, velocity: VELOCITY.snare, duration: 0.15, chance: 0.5, salt: 2 },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 92, duration: 0.9 },
      { degree: 'fifth', beat: 2, velocity: 88, duration: 0.9, bars: 'even' },
      { degree: 'seventh', beat: 2, velocity: 88, duration: 0.9, bars: 'odd' },
    ],
    cell: { notesPerCell: 2, duration: 0.4 },
    velocity: { min: 45, max: 110 },
    grid: 'eighth',
    tempo: { min: 90, max: 220 },
    generator: 'jazz',
    instrument: 'PolySynth',
  },
  {
    id: 'funk',
    label: 'Funk',
    icon: '🎸',
    verbs: 'syncopated sixteenths, a short riff with silence between the notes, land on the off-beats',
    notes: { state: 4, develop: 5, cadence: 3, fewest: 3 },
    verbStyle: 'riff',
    drums: [
      { voice: 'kick', beat: 0, velocity: VELOCITY.kick },
      { voice: 'kick', beat: 0.75, velocity: VELOCITY.kick },
      { voice: 'kick', beat: 2, velocity: VELOCITY.kick },
      { voice: 'snare', beat: 1, velocity: VELOCITY.snare },
      { voice: 'snare', beat: 3, velocity: VELOCITY.snare },
      { voice: 'hat', beat: 0, velocity: VELOCITY.hat, duration: 0.15, repeatTo: 4, repeatStep: 0.25 },
      { voice: 'tom', beat: 3.5, velocity: VELOCITY.tom, chance: 0.6, salt: 1 },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 95, duration: 0.4 },
      { degree: 'root', beat: 0.75, velocity: 80, duration: 0.2 },
      { degree: 'fifth', beat: 1.5, velocity: 85, duration: 0.3 },
      { degree: 'root', beat: 2.5, velocity: 80, duration: 0.3 },
    ],
    cell: { notesPerCell: 2, duration: 0.28 },
    velocity: { min: 40, max: 110 },
    grid: 'sixteenth',
    tempo: { min: 90, max: 130 },
    generator: 'funk',
    instrument: 'PluckSynth',
  },
  {
    id: 'ambient',
    label: 'Ambient',
    icon: '🌊',
    verbs: 'long tones and drones, almost no rhythm, let each note ring into the next',
    notes: { state: 5, develop: 6, cadence: 3, fewest: 5 },
    verbStyle: 'melody',
    drums: [
      { voice: 'kick', beat: 0, velocity: 70, duration: 0.4, bars: 'even' },
      { voice: 'hat', beat: 2, velocity: 40, duration: 0.3 },
    ],
    bass: [{ degree: 'root', beat: 0, velocity: 70, duration: 2 }],
    cell: { notesPerCell: 1, duration: 0.9 },
    velocity: { min: 25, max: 90 },
    grid: 'eighth',
    tempo: { min: 50, max: 90 },
    generator: 'ambient',
    instrument: 'AMSynth',
  },
  {
    id: 'latin',
    label: 'Latin',
    icon: '🪘',
    verbs: 'a clave feel, short answers around a two bar pattern, leave the downbeat to the drums',
    notes: { state: 5, develop: 6, cadence: 3, fewest: 4 },
    verbStyle: 'riff',
    drums: [
      { voice: 'kick', beat: 0, velocity: 92 },
      { voice: 'kick', beat: 1.5, velocity: 84 },
      { voice: 'snare', beat: 2.5, velocity: 80, duration: 0.15 },
      { voice: 'hat', beat: 0, velocity: 50, duration: 0.14, repeatTo: 4, repeatStep: 0.5 },
      { voice: 'tom', beat: 3, velocity: 86, chance: 0.45, salt: 4 },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 92, duration: 0.5 },
      { degree: 'fifth', beat: 1.5, velocity: 84, duration: 0.4 },
      { degree: 'root', beat: 2.5, velocity: 80, duration: 0.4 },
    ],
    cell: { notesPerCell: 2, duration: 0.35 },
    velocity: { min: 40, max: 108 },
    grid: 'eighth',
    tempo: { min: 80, max: 120 },
    generator: 'jazz',
    instrument: 'PluckSynth',
  },
  {
    id: 'afrobeat',
    label: 'Afrobeat',
    icon: '🥁',
    verbs: 'interlocking short phrases against the drums, two beats on and two off, never all at once',
    notes: { state: 4, develop: 5, cadence: 3, fewest: 3 },
    verbStyle: 'riff',
    drums: [
      { voice: 'kick', beat: 0, velocity: 100 },
      { voice: 'kick', beat: 0.75, velocity: 96 },
      { voice: 'kick', beat: 2.5, velocity: 96 },
      { voice: 'snare', beat: 1, velocity: 86 },
      { voice: 'snare', beat: 3, velocity: 86 },
      { voice: 'hat', beat: 0, velocity: 52, duration: 0.13, repeatTo: 4, repeatStep: 0.25 },
      { voice: 'tom', beat: 3.5, velocity: 90, chance: 0.5, salt: 5 },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 96, duration: 0.35 },
      { degree: 'root', beat: 1.5, velocity: 82, duration: 0.25 },
      { degree: 'fifth', beat: 2.5, velocity: 88, duration: 0.3 },
      { degree: 'seventh', beat: 3.5, velocity: 78, duration: 0.2 },
    ],
    cell: { notesPerCell: 2, duration: 0.3 },
    velocity: { min: 45, max: 112 },
    grid: 'sixteenth',
    tempo: { min: 100, max: 125 },
    generator: 'funk',
    instrument: 'PluckSynth',
  },
  {
    id: 'house',
    label: 'House',
    icon: '🎛️',
    verbs: 'one held chord stab on the offbeats, sparse, let the kick carry the bar',
    notes: { state: 3, develop: 4, cadence: 2, fewest: 3 },
    verbStyle: 'riff',
    drums: [
      { voice: 'kick', beat: 0, velocity: 104 },
      { voice: 'kick', beat: 1, velocity: 104 },
      { voice: 'kick', beat: 2, velocity: 104 },
      { voice: 'kick', beat: 3, velocity: 104 },
      { voice: 'hat', beat: 0.5, velocity: 58, duration: 0.12 },
      { voice: 'hat', beat: 1.5, velocity: 58, duration: 0.12 },
      { voice: 'hat', beat: 2.5, velocity: 58, duration: 0.12 },
      { voice: 'hat', beat: 3.5, velocity: 58, duration: 0.12 },
    ],
    bass: [
      { degree: 'root', beat: 0.5, velocity: 90, duration: 0.4 },
      { degree: 'root', beat: 1.5, velocity: 86, duration: 0.4 },
      { degree: 'fifth', beat: 2.5, velocity: 86, duration: 0.4 },
      { degree: 'root', beat: 3.5, velocity: 86, duration: 0.4 },
    ],
    cell: { notesPerCell: 1, duration: 0.25 },
    velocity: { min: 40, max: 110 },
    grid: 'offbeat',
    tempo: { min: 118, max: 128 },
    generator: 'funk',
    instrument: 'PolySynth',
  },
  {
    id: 'lofi',
    label: 'Lo-fi',
    icon: '📻',
    verbs: 'behind the beat, soft, two or three notes and a rest, never a full bar of them',
    notes: { state: 4, develop: 5, cadence: 3, fewest: 4 },
    verbStyle: 'melody',
    drums: [
      { voice: 'kick', beat: 0, velocity: 88 },
      { voice: 'kick', beat: 2.5, velocity: 80 },
      { voice: 'snare', beat: 1, velocity: 74, duration: 0.18 },
      { voice: 'snare', beat: 3, velocity: 74, duration: 0.18 },
      { voice: 'hat', beat: 0, velocity: 40, duration: 0.2, repeatTo: 4, repeatStep: 0.5 },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 80, duration: 1.2 },
      { degree: 'fifth', beat: 2.5, velocity: 72, duration: 0.8 },
    ],
    cell: { notesPerCell: 2, duration: 0.5 },
    velocity: { min: 30, max: 88 },
    grid: 'eighth',
    tempo: { min: 70, max: 90 },
    generator: 'jazz',
    instrument: 'AMSynth',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    icon: '🎬',
    verbs: 'long lines that resolve slowly, one idea per phrase, more space than notes',
    notes: { state: 3, develop: 4, cadence: 2, fewest: 3 },
    verbStyle: 'melody',
    drums: [
      { voice: 'kick', beat: 0, velocity: 64, duration: 0.5, bars: 'even' },
      { voice: 'tom', beat: 2, velocity: 58, duration: 0.4, bars: 'odd' },
    ],
    bass: [{ degree: 'root', beat: 0, velocity: 62, duration: 3.5 }],
    cell: { notesPerCell: 1, duration: 1.2 },
    velocity: { min: 25, max: 80 },
    grid: 'eighth',
    tempo: { min: 60, max: 90 },
    generator: 'ambient',
    instrument: 'AMSynth',
  },
  {
    id: 'random',
    label: 'Random',
    icon: '🎲',
    verbs: 'whatever the last bar did not do, chosen from the room\'s other styles bar by bar',
    notes: { state: 6, develop: 7, cadence: 3, fewest: 5 },
    verbStyle: 'melody',
    drums: [
      { voice: 'kick', beat: 0, velocity: VELOCITY.kick },
      { voice: 'snare', beat: 2, velocity: VELOCITY.snare },
    ],
    bass: [
      { degree: 'root', beat: 0, velocity: 90, duration: 1 },
      { degree: 'fifth', beat: 2, velocity: 85, duration: 1 },
    ],
    cell: { notesPerCell: 2, duration: 0.4 },
    velocity: { min: 40, max: 110 },
    grid: 'eighth',
    tempo: { min: 60, max: 200 },
    generator: 'random',
    instrument: 'PolySynth',
    rotates: ['jazz', 'funk', 'ambient'],
  },
];

/** Every style id, in the order the panel lists them. */
export const STYLE_IDS = STYLE_ROWS.map(row => row.id) as AgentStyleId[];

const BY_ID = new Map<AgentStyleId, StyleRow>(STYLE_ROWS.map(row => [row.id, row]));

/** The row for a style. An unknown id answers the jazz row rather than undefined, because a room with a
 *  stored style from an older build must still play something. */
export function styleRow(id: string | undefined): StyleRow {
  return BY_ID.get((id ?? 'jazz') as AgentStyleId) ?? BY_ID.get('jazz')!;
}

/**
 * WHICH ROW A BAR USES, after rotation. `random` has no shape of its own: it walks the rows it lists,
 * one per bar, which is the behaviour the groove switch had before this table existed.
 */
export function rowForBar(id: string | undefined, barIndex: number): StyleRow {
  const row = styleRow(id);
  if (!row.rotates || row.rotates.length === 0) return row;
  const picked = row.rotates[((barIndex % row.rotates.length) + row.rotates.length) % row.rotates.length]!;
  return styleRow(picked);
}
