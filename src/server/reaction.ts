/**
 * THE REACTION VOICE INSIDE THE BAR.
 *
 * At a stride above one the agent writes a full bar only every stride-th bar, and the bars in between
 * used to be played by the pattern generator: a fresh random walk in the room's key that said nothing
 * about what the agent had just played. Measured 2026-10-30 on the live room at 200 BPM (probe, three
 * agents, backing on): 37 of 72 bar records were generator bars, so half of what a listener heard from
 * an agent was music that agent had not said.
 *
 * A gap bar is instead TWO TO FOUR SHORT CELLS quoting the agent's own material: the pitches it last
 * played (its motif, or its hook), moved into the register its own decision asked for, tidied into the
 * room's key, on the bar's eighth grid. Short on purpose: a gap bar sits between two statements, so it
 * may answer and decorate, it may not become a second melody.
 *
 * Everything here is deterministic. The bar number picks which of the agent's pitches each cell starts
 * from and never `Math.random`, so the same bar always plays the same cells and a test can assert them
 * exactly.
 */
import {
  midiOf,
  noteNameFromMidi,
  scalePitchClasses,
  snapPitchToKey,
  type AgentStyle,
  type GeneratedNote,
} from '@/shared/music';
import type { Motif } from './listener';

/** A gap bar is short: six notes is three two-note cells, and a bar that needs more is a statement. */
export const CELL_MAX_NOTES = 6;

/** More than four cells in one bar is the generator again, with a different name. */
export const CELL_MAX = 4;

export interface ReactionInput {
  /** what this agent last played; null before its first statement of its own */
  motif: Motif | null;
  /** its hook, a fuller statement than the motif: the fallback when the motif is missing */
  hook: GeneratedNote[] | null;
  key: string;
  style: AgentStyle;
  /** the bar being filled, so two gap bars never start on the same pitch */
  bar: number;
  /** the midi window the agent's last decision asked for */
  register: { low: number; high: number };
  /** how many cells fit in this bar (see `cellsForBar`) */
  cells: number;
  /** the room's level, so a soft room is answered softly */
  meanVelocity?: number;
}

export interface ReactionBar {
  notes: GeneratedNote[];
  /** how many cells the bar actually holds, for the debug record */
  cells: number;
  /** one line a listener can read: which of its own notes each cell starts on */
  describe: string;
}

interface CellShape {
  /** notes per cell: a stab is two, a held ambient cell is one */
  notesPerCell: number;
  /** how long a note sounds, in beats */
  duration: number;
}

/**
 * WHAT A CELL IS, PER STYLE. Funk answers in stabs, ambient in one held note, jazz in a two-note
 * figure that leaves the rest of the bar open. The values are beats, like every other duration in the
 * room, so the same number means the same music at any tempo.
 */
function cellShape(style: AgentStyle): CellShape {
  if (style === 'funk') return { notesPerCell: 2, duration: 0.28 };
  if (style === 'ambient') return { notesPerCell: 1, duration: 0.9 };
  return { notesPerCell: 2, duration: 0.4 };
}

/**
 * WHERE THE CELLS SIT. Evenly on the bar's eighth grid, the first on the downbeat, so a cell never
 * lands between two slots and the drummer is never masked for a whole beat.
 */
export function cellSlots(cells: number, maxCells: number = CELL_MAX): number[] {
  const n = Math.max(1, Math.min(Math.max(1, maxCells), Math.round(cells)));
  return Array.from({ length: n }, (_unused, i) => Math.round((i * 8) / n) / 2);
}

/** The pitch class the key starts on, as a midi number as close to `centre` as an octave allows. */
function midiNear(pitchClass: number, centre: number): number {
  return pitchClass + 12 * Math.round((centre - pitchClass) / 12);
}

/** Move a pitch into the band its decision asked for, then tidy it into the key. */
function placePitch(pitch: string, register: { low: number; high: number }, key: string): string {
  let midi = midiOf(pitch);
  if (midi === null) {
    // A pitch that cannot be read is not a note this room will play: take the key's own centre.
    midi = Math.round((register.low + register.high) / 2);
  }
  // Octave by octave, never a clamp: clamping to the band's edge changes the pitch, and a cell that
  // sounds a different note from the one it quotes is not a quote.
  while (midi < register.low) midi += 12;
  while (midi > register.high) midi -= 12;
  return snapPitchToKey(noteNameFromMidi(midi), key);
}

/**
 * THE AGENT'S OWN PITCHES, or a seed when it has not played yet.
 *
 * The first gap bar of a room can arrive before the agent's first statement has been heard, and a gap
 * bar with nothing in it is a hole. The seed is the key's own tonic, third and fifth in the agent's
 * register: a small opening gesture in the room's voice, not the generator's.
 */
function sourcePitches(input: ReactionInput): string[] {
  const own = input.motif?.pitches ?? [];
  if (own.length > 0) return own;
  const hook = input.hook?.map(n => n.pitch) ?? [];
  if (hook.length > 0) return hook;
  const allowed = scalePitchClasses(input.key);
  const centre = Math.round((input.register.low + input.register.high) / 2);
  const degrees = [0, 2, 4].map(d => allowed[d] ?? allowed[0] ?? 0);
  return degrees.map(pc => noteNameFromMidi(midiNear(pc, centre)));
}

/**
 * The cells for one gap bar. Deterministic in (bar, cells, style, motif): the same bar played twice
 * produces the same notes, which is what lets a test assert them and a listener hear a band rather
 * than a dice roll.
 */
export function reactionCells(input: ReactionInput): ReactionBar {
  const source = sourcePitches(input);
  const shape = cellShape(input.style);
  const slots = cellSlots(input.cells);
  const ceiling = Math.max(40, Math.min(110, input.meanVelocity ?? 92));

  const notes: GeneratedNote[] = [];
  let usedCells = 0;

  for (let i = 0; i < slots.length; i++) {
    if (notes.length >= CELL_MAX_NOTES) break;
    // WHICH NOTE THE CELL STARTS ON moves with the bar, so two gap bars in a row do not play the
    // same cell; it is a rotation through the agent's own pitches, so the material is always its.
    const start = (input.bar + i) % source.length;
    const slot = slots[i] ?? 0;
    usedCells++;

    for (let k = 0; k < shape.notesPerCell; k++) {
      if (notes.length >= CELL_MAX_NOTES) break;
      const pitch = placePitch(source[(start + k) % source.length] ?? source[0]!, input.register, input.key);
      // The second note of a cell sits a sixteenth after the first: two notes on one slot are a dyad,
      // which is a different gesture and doubles the weight of the beat.
      const beatTime = slot + k * 0.25;
      if (beatTime >= 4) continue;
      // FIRST CELL LOUDEST, THEN THE BAR TAPERS: a gap bar is a reply, and a reply does not end louder
      // than it started.
      const velocity = Math.round(Math.max(38, Math.min(110, ceiling * (1 - 0.18 * i))));
      // The last cell is the landing: held longer, so the bar closes instead of stopping.
      const last = i === slots.length - 1 && k === shape.notesPerCell - 1;
      notes.push({
        pitch,
        beatTime,
        velocity,
        duration: Math.round(shape.duration * (last ? 1.6 : 1) * 100) / 100,
      });
    }
  }

  const describe = notes.length === 0
    ? '0 cells, the agent has nothing to quote'
    : `${usedCells} cell${usedCells === 1 ? '' : 's'} from its own line: ` +
      notes.map(n => `${n.pitch}@${n.beatTime}`).join(' ');

  return { notes, cells: usedCells, describe };
}
