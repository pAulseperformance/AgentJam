/**
 * THE LISTENER: what the room sounds like right now, in words a decision model can judge.
 *
 * Before this file, the agent's whole context was "the last 20 notes, flattened to pitch@beat", read
 * from `pendingFlush`, which the persistence timer drains every 5s. So for 5 seconds out of every 5
 * the bar was generated against an EMPTY room, and it never had the shape of what you played: not the
 * contour, not where you left silence, not what you were holding.
 *
 * Everything here is deterministic and cheap. It reads events that already crossed the socket and
 * turns them into a small typed summary. The model gets that summary; it never gets a raw note dump.
 */

import { midiOf, pitchClassOf } from '@/shared/music';

/**
 * A note as the listener reads it. The wire event has no duration (a note_off carries the end), so the
 * room records the duration it scheduled and hands it here; a phrase's articulation depends on it.
 */
export interface NoteRecord {
  peerId: string;
  type: 'note_on' | 'note_off';
  pitch: string;
  beatTime: number;
  velocity: number;
  timestamp: number;
  duration?: number;
}

/** Where a phrase sits, relative to middle C (C4 = 60). */
export type RegisterBand = 'low' | 'mid' | 'high';

export interface PhraseSummary {
  /** how many notes were played in the window */
  count: number;
  /** the shape of the line, first half against second half */
  contour: 'rising' | 'falling' | 'flat' | 'wave' | 'none';
  register: RegisterBand;
  /** short = stabs under half a beat, long = sustained past one beat */
  articulation: 'short' | 'long' | 'mixed' | 'none';
  /**
   * HOW HARD THEY ARE PLAYING. A partner answers a shouted phrase with a shout and a whispered one
   * with a whisper; before this the room heard pitch and rhythm and nothing about touch.
   */
  loudness: 'soft' | 'medium' | 'loud' | 'none';
  /** mean velocity of the phrase, 1-127, which is what the reply is matched to */
  meanVelocity: number;
  /** the hardest note they played */
  peakVelocity: number;
  /** the 16 sixteenth slots of the last bar, true where a note was sounding */
  usedSlots: boolean[];
  /** the slots of the NEXT bar that nobody used in the last one: where there is room */
  openSlots: number[];
  /** what sat on the strong beats (0 and 2), the notes a listener actually hears as the line */
  strongBeatPitches: string[];
  /** pitch classes used, for answering without repeating verbatim */
  pitchClasses: number[];
  /** the last note of the phrase, which is what an answer usually responds to */
  lastPitch: string | null;
  /** the pitches of the window in order, for the repairer's answer constraint */
  pitches: string[];
  /** pitches still held down right now */
  held: string[];
}

const midiSafe = (pitch: string): number => midiOf(pitch) ?? 60;

function bandOf(midi: number): RegisterBand {
  if (midi < 60) return 'low';
  if (midi <= 71) return 'mid';
  return 'high';
}

function contourOf(midis: number[]): PhraseSummary['contour'] {
  if (midis.length === 0) return 'none';
  if (midis.length < 3) return 'flat';
  const half = Math.floor(midis.length / 2);
  const first = midis.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(half, 1);
  const last = midis.slice(half).reduce((a, b) => a + b, 0) / Math.max(midis.length - half, 1);
  const delta = last - first;
  const peak = Math.max(...midis);
  const trough = Math.min(...midis);
  const spread = peak - trough;
  // a line that goes up and comes back down is neither rising nor flat, it is a wave, and it needs a
  // different answer (answer the peak, not the average)
  if (spread > 5 && Math.abs(delta) <= 4) return 'wave';
  if (delta > 2) return 'rising';
  if (delta < -2) return 'falling';
  return spread > 5 ? 'wave' : 'flat';
}

function loudnessOf(velocities: number[]): PhraseSummary['loudness'] {
  if (velocities.length === 0) return 'none';
  const mean = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  if (mean <= 55) return 'soft';
  if (mean <= 95) return 'medium';
  return 'loud';
}

function articulationOf(durations: number[]): PhraseSummary['articulation'] {
  if (durations.length === 0) return 'none';
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  if (mean <= 0.5) return 'short';
  if (mean >= 1) return 'long';
  return 'mixed';
}

/**
 * Summarize one window of note_on events.
 *
 * `barStartMs` is the server time the window's bar began, so a phrase is placed against the grid the
 * agent will answer on rather than the wall clock.
 */
export function summarizePhrase(
  events: NoteRecord[],
  opts: { barStartMs: number; barMs: number; beatMs: number },
): PhraseSummary {
  const on = events.filter(e => e.type === 'note_on');
  const midis = on.map(e => midiSafe(e.pitch));
  const used = Array.from({ length: 16 }, () => false);

  const held = new Set<string>();
  for (const e of events) {
    if (e.type === 'note_off') held.delete(e.pitch);
    else if (e.type === 'note_on') held.add(e.pitch);
  }

  const strong: string[] = [];
  for (const e of on) {
    // place the note against the bar it was played in, then mark the sixteenths it covered
    const offsetMs = typeof e.timestamp === 'number' ? e.timestamp - opts.barStartMs : 0;
    const wrapped = ((offsetMs % opts.barMs) + opts.barMs) % opts.barMs;
    const beat = wrapped / opts.beatMs;
    const slot = Math.max(0, Math.min(15, Math.floor(beat * 4)));
    used[slot] = true;
    const span = Math.max(1, Math.round((e.duration ?? 0.25) * 4));
    for (let i = 1; i < span && slot + i < 16; i++) used[slot + i] = true;
    if (slot % 4 === 0) strong.push(e.pitch);
  }

  const velocities = on.map(e => e.velocity || 80);
  const meanVelocity = velocities.length
    ? Math.round(velocities.reduce((a, b) => a + b, 0) / velocities.length)
    : 80;

  return {
    count: on.length,
    contour: contourOf(midis),
    loudness: loudnessOf(velocities),
    meanVelocity,
    peakVelocity: velocities.length ? Math.max(...velocities) : 80,
    register: midis.length ? bandOf(midis.slice().sort((a, b) => a - b)[Math.floor(midis.length / 2)]!) : 'mid',
    articulation: articulationOf(on.map(e => e.duration ?? 0.5)),
    usedSlots: used,
    openSlots: used.map((u, i) => (u ? -1 : i)).filter(i => i >= 0),
    strongBeatPitches: strong.slice(-4),
    pitchClasses: [...new Set(on.map(e => pitchClassOf(e.pitch)).filter((p): p is number => p !== null))],
    lastPitch: on.length ? on[on.length - 1]!.pitch : null,
    pitches: on.slice(-12).map(e => e.pitch),
    held: [...held],
  };
}

export interface Motif {
  /** the pitches the agent itself played, in time order (up to 4) */
  pitches: string[];
  /** where each sat, in sixteenth slots */
  slots: number[];
}

/** The agent's own last bar, kept so it has an idea to develop instead of a new one every bar. */
export function motifFrom(notes: Array<{ pitch: string; beatTime: number }>): Motif | null {
  if (notes.length === 0) return null;
  const take = notes.slice(0, 4);
  return {
    pitches: take.map(n => n.pitch),
    slots: take.map(n => Math.max(0, Math.min(15, Math.round(n.beatTime * 4)))),
  };
}

/** Human-readable lines for the prompt. Short by design: a 3B model wastes words it cannot spend. */
export function describePhrase(summary: PhraseSummary): string {
  if (summary.count === 0) return 'the room is silent, nobody has played recently';
  const strong = summary.strongBeatPitches.join(', ') || 'nothing on the strong beats';
  const open = summary.openSlots.length ? `open slots at ${summary.openSlots.slice(0, 6).join(', ')} (sixteenths)` : 'the bar is full';
  return [
    `${summary.count} notes, contour ${summary.contour}, ${summary.register} register, ${summary.articulation} articulation, ${summary.loudness} at mean velocity ${summary.meanVelocity} (peak ${summary.peakVelocity})`,
    `strong beats: ${strong}; last note: ${summary.lastPitch ?? 'none'}`,
    `they are holding: ${summary.held.join(', ') || 'nothing'}`,
    open,
  ].join('; ');
}

export function describeMotif(motif: Motif | null): string {
  if (!motif) return 'none yet (this would be your first statement)';
  return motif.pitches.map((p, i) => `${p}@${((motif.slots[i] ?? 0) / 4).toFixed(2)}`).join(', ');
}
