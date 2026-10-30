/**
 * THE LINE. A melody is not three triad tones repeated: it is a phrase with a direction, a rhythm that
 * keeps an idea, and a place to land.
 *
 * MEASURED, live, solo agent, 16 bars (2026-10-30): 3.2 notes per bar, no bar over four notes, and the
 * same arpeggio (`E4 C4 G4`) stated over and over. The cause was not the model alone: the decision
 * layer answered `density: sparse` for every bar, and the prompt's sparse rule asks for 2-4 notes. A
 * room with nobody in it heard a loop, not a tune.
 *
 * So the SHAPE is code and the NOTES are the model's, the same split the drummer already uses: a
 * four-bar arc (state, restate, develop, cadence) with a contour per position, and a completion step
 * that turns a short or leapy bar into a line by walking in key along the arc's direction. The model
 * still writes what it can; this is what happens when it writes a triad.
 */
import {
  type GeneratedNote,
  midiOf,
  noteNameFromMidi,
  scalePitchClasses,
} from '../shared/music/pattern-generator';
import type { Motif } from './listener';

export type ArcPosition = 'state' | 'restate' | 'develop' | 'cadence';
export type Contour = 'arch' | 'rising' | 'falling' | 'wave';

export interface MelodyPlan {
  position: ArcPosition;
  contour: Contour;
  /** how many notes a line of this shape should carry in one bar */
  wantNotes: number;
  /** one line for the prompt, plain words, no music theory */
  instruction: string;
}

const ARC: ArcPosition[] = ['state', 'restate', 'develop', 'cadence'];

/** The plan for a bar, from its place in the four-bar phrase. */
export function melodyPlan(bar: number, style: string, hasMotif: boolean): MelodyPlan {
  const position = ARC[((bar % 4) + 4) % 4]!;

  // A phrase that starts in the middle of nowhere is a phrase with no beginning, so a first statement
  // gets the simplest contour and the shortest line.
  const contour: Contour = position === 'state'
    ? 'arch'
    : position === 'restate'
      ? 'arch'
      : position === 'develop'
        ? (hasMotif ? 'wave' : 'rising')
        : 'falling';

  // Denser for the styles that expect it, never below five: four notes is a gesture, five is a line.
  const base = style === 'ambient' ? 5 : style === 'funk' ? 7 : 6;
  // FIVE IS THE FLOOR. Four notes is a gesture, and a decision layer told to be economical will
  // otherwise hand a room four notes and call it a cadence.
  const wantNotes = Math.max(5, position === 'state' ? base : position === 'cadence' ? base - 1 : base + 1);

  const instruction = [
    `PLAY A MELODY, not a chord: ${wantNotes} notes in one line, moving ${contour === 'arch' ? 'up then down' : contour === 'rising' ? 'upward' : contour === 'falling' ? 'downward' : 'in waves'}.`,
    position === 'state'
      ? 'This bar states the idea: make it clear and simple, and it must be worth repeating.'
      : position === 'restate'
        ? 'This bar repeats the idea with ONE change (a different rhythm, or one note moved), so a listener hears it come back.'
        : position === 'develop'
          ? 'This bar develops the idea: same shape, different notes, reaching further than the first statement.'
          : 'This bar lands the phrase: fewer notes, ending somewhere the next phrase can start.',
    'Most moves should be one or two scale steps, not jumps across the chord.',
  ].join(' ');

  return { position, contour, wantNotes, instruction };
}

/** Ascending pitch classes of the room's key, so a step is a step and not a guess. */
function keyWalk(key: string, startMidi: number, direction: 1 | -1, steps: number): number[] {
  const allowed = scalePitchClasses(key);
  const out: number[] = [];
  let midi = startMidi;
  let guard = 0;
  while (out.length < steps && guard++ < 60) {
    midi += direction;
    const pc = ((midi % 12) + 12) % 12;
    if (allowed.includes(pc)) out.push(midi);
  }
  return out;
}

/**
 * COMPLETE THE LINE. Given what the model wrote, return a bar that is a melody: at least `wantNotes`
 * notes, mostly stepwise, inside the register, in key, on the sixteenth grid.
 *
 * It is deliberately additive: a bar that is already a line is returned untouched (a caller comparing
 * lengths sees the same array), because the model's own contours are worth keeping when they exist.
 */
export function completeMelody(
  notes: GeneratedNote[],
  options: {
    plan: MelodyPlan;
    key: string;
    motif: Motif | null;
    /** lowest and highest midi this bar may use */
    register: { low: number; high: number };
    maxNotes?: number;
  },
): { notes: GeneratedNote[]; completed: boolean; added: number } {
  const { plan, key, motif, register } = options;
  const maxNotes = options.maxNotes ?? 10;
  const target = Math.min(maxNotes, plan.wantNotes);

  const existing = notes
    .filter(n => midiOf(n.pitch) !== null)
    .slice()
    .sort((a, b) => a.beatTime - b.beatTime);

  // What counts as a line: enough notes, and most moves small. A bar of triads is not a melody even
  // when it has six notes in it.
  const midis = existing.map(n => midiOf(n.pitch)!);
  let stepMoves = 0;
  for (let i = 1; i < midis.length; i++) if (Math.abs(midis[i]! - midis[i - 1]!) <= 2) stepMoves++;
  const moves = Math.max(1, midis.length - 1);
  const alreadyALine = existing.length >= target && stepMoves / moves >= 0.4;
  if (alreadyALine) return { notes, completed: false, added: 0 };

  // THE FIRST NOTE IS THE IDEA. A triad's second and third notes are the arpeggio that made this bar
  // not a melody, so they are dropped and the line is built from the note the model opened with.
  // Appending to an arpeggio leaves it an arpeggio: measured, that kept two leaps in five moves.
  const anchor = existing[0];
  const anchorMidi = anchor ? midiOf(anchor.pitch) ?? null : null;
  const seedMidi = anchorMidi ?? (motif ? midiOf(motif.pitches[0]!) ?? 60 : Math.round((register.low + register.high) / 2));
  const keep = anchor ? [anchor] : [];
  const seedNotes = keep.length;
  const direction: 1 | -1 = plan.contour === 'falling' ? -1 : plan.contour === 'rising' ? 1 : midis.length > 1 && midis.at(-1)! > midis[0]! ? -1 : 1;

  // The rhythm: the motif's own slots when there is one, so a restate keeps its rhythm; otherwise
  // evenly spread sixteenths that leave the last beat free for the landing.
  const motifSlots = motif?.slots?.filter(s => s >= 0 && s < 16) ?? [];
  const wanted = Math.max(0, target - seedNotes);
  // THE MOTIF'S RHYTHM FIRST, then whatever is needed to reach the length: a restate that keeps its
  // rhythm is heard as the idea coming back, and one that invents a new rhythm is a new idea.
  const used = new Set(keep.map(n => Math.round(n.beatTime * 4)));
  const freeSlots: number[] = [];
  for (const slot of motifSlots) {
    if (freeSlots.length >= wanted) break;
    if (used.has(slot) || freeSlots.includes(slot)) continue;
    freeSlots.push(slot);
    used.add(slot);
  }
  for (let slot = 1; slot < 16 && freeSlots.length < wanted; slot += 2) {
    if (used.has(slot)) continue;
    freeSlots.push(slot);
    used.add(slot);
  }
  freeSlots.sort((a, b) => a - b);

  const walk = keyWalk(key, seedMidi, direction, freeSlots.length * 2);
  const added: GeneratedNote[] = [];
  let cursor = 0;
  for (const slot of freeSlots) {
    // one or two scale steps, alternating, so the line breathes instead of climbing a ladder
    const advance = 1 + (added.length % 2);
    const midi = walk[Math.min(walk.length - 1, cursor + advance)] ?? walk.at(-1) ?? seedMidi;
    cursor = Math.min(walk.length - 1, cursor + advance);
    const clamped = Math.max(register.low, Math.min(register.high, midi));
    const velocity = anchor?.velocity ?? 80;
    added.push({
      pitch: noteNameFromMidi(clamped),
      beatTime: slot / 4,
      velocity,
      duration: 0.25,
    });
  }

  const merged = [...keep, ...added].sort((a, b) => a.beatTime - b.beatTime);
  return { notes: merged, completed: true, added: added.length };
}
