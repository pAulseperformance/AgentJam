/**
 * THE REPAIRER: everything the room can decide about a measure without asking a model.
 *
 * A language model writes a plausible bar; it does not reliably write a bar that is IN the key, ON the
 * grid, and clear of the notes someone else is already holding. Measured on the live room before this
 * file existed: 39% of the agent's notes were outside C major, and its bar landed 923ms late because
 * nothing put the notes on the transport grid.
 *
 * So the model's bar is treated as a draft. These five passes are deterministic, cheap, and never
 * worth a model call:
 *   - grid: every note sits on a sixteenth of the bar
 *   - key: a stray pitch moves to the nearest pitch in the key, keeping its register
 *   - unison: a pitch someone else is holding right now is dropped, not transposed
 *   - density: the bar is capped, so "dense" cannot become a wall of notes
 *   - shape: sorted by time, de-duplicated per grid slot, velocities in MIDI 1-127
 *
 * Nothing else is changed: the model keeps its line, its rhythm and its dynamics.
 */

import {
  type GeneratedNote,
  snapPitchToKey,
  isInKey,
  pitchClassOf,
  midiOf,
  noteNameFromMidi,
} from '@/shared/music';

/** A sixteenth of a beat, the grid everything lands on. */
const GRID = 0.25;

/** The only spelling the synth accepts: a letter, an optional accidental, an octave. */
const PLAYABLE_PITCH = /^[A-G][#b]?\d$/;

export interface RepairOptions {
  /** the room's key, in the app's own spelling (`C major`, `A minor`) */
  key: string;
  /** pitches another peer is holding right now: a bar may not double a sustained note */
  heldPitches?: string[];
  /** hard ceiling per bar */
  maxNotes?: number;
  /**
   * THE ANSWER. When the agent decided to answer what you played, an answer that shares none of your
   * pitches is not an answer, it is a coincidence in the same room. If the model's bar shares nothing,
   * one note (the one closest to your last pitch) moves onto that pitch class, keeping its register.
   */
  answerPitches?: string[];
  /**
   * PLAY AT THEIR LEVEL. The listener reads how hard the room is playing; this is the number the bar
   * is brought to. The model is told the level in the prompt as well, but a 3B model's dynamics are
   * not reliable, so the rule that actually holds is here, in code.
   */
  targetMeanVelocity?: number;
}

export interface RepairReport {
  notes: GeneratedNote[];
  /** whether the bar shares a pitch class with the phrase it was answering (true when not answering) */
  answered: boolean;
  dropped: {
    /** notes whose velocity was moved to follow the room's level */
    rescaled: number;
    /** not a playable note name at all, e.g. the model wrote `Am4` (a chord) instead of a pitch */
    invalid: number;
    offGrid: number;
    outOfKey: number;
    unison: number;
    duplicate: number;
    overCap: number;
  };
}

function snapToGrid(beatTime: number): number {
  return Math.max(0, Math.min(3.75, Math.round(beatTime / GRID) * GRID));
}

/** MIDI 1-127 on the wire; a 0-1 velocity from an older generator is scaled, not guessed. */
function normalizeVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 80;
  const v = velocity <= 1.5 ? velocity * 127 : velocity;
  return Math.max(1, Math.min(127, Math.round(v)));
}

export function repairMeasure(notes: GeneratedNote[], options: RepairOptions): RepairReport {
  const maxNotes = options.maxNotes ?? 10;
  const held = new Set((options.heldPitches ?? []).map(p => p.trim()));
  const dropped = { rescaled: 0, invalid: 0, offGrid: 0, outOfKey: 0, unison: 0, duplicate: 0, overCap: 0 };

  const repaired: GeneratedNote[] = [];

  for (const note of notes) {
    const pitch = String(note.pitch ?? '').trim();
    // A model that writes `Am4` or `E4/E5` is not naming one note; playing the text would only
    // produce a synth error, so it is counted and dropped here.
    if (!PLAYABLE_PITCH.test(pitch)) { dropped.invalid++; continue; }

    // GRID. A model that writes 0.37 gets 0.25: the room's sixteenth is the only legal address.
    const onGrid = snapToGrid(note.beatTime);
    if (Math.abs(onGrid - note.beatTime) > 0.001) dropped.offGrid++;

    // UNISON. Someone is holding that note right now; playing it doubles their voice instead of
    // answering it.
    if (held.has(pitch)) { dropped.unison++; continue; }

    // KEY. Move it, do not mute it: a stray accidental is a mistake in address, not in intent.
    const inKey = isInKey(pitch, options.key);
    const snapped = inKey ? pitch : snapPitchToKey(pitch, options.key);
    if (!inKey) dropped.outOfKey++;
    if (held.has(snapped)) { dropped.unison++; continue; }

    repaired.push({
      pitch: snapped,
      beatTime: onGrid,
      velocity: normalizeVelocity(note.velocity),
      duration: Math.max(GRID, Math.min(4, Math.round(note.duration / GRID) * GRID || GRID)),
    });
  }

  // ANSWER. One deterministic correction, because the intent was explicit and the model may ignore it.
  let answered = true;
  const targets = (options.answerPitches ?? [])
    .map(pc => pitchClassOf(pc))
    .filter((pc): pc is number => pc !== null);

  if (targets.length > 0) {
    answered = repaired.some(n => {
      const pc = pitchClassOf(n.pitch);
      return pc !== null && targets.includes(pc);
    });

    if (!answered && repaired.length > 0) {
      const anchorMidi = midiOf(options.answerPitches!.at(-1)!) ?? 60;
      const targetPc = ((anchorMidi % 12) + 12) % 12;
      // the note closest in register to what they played is the one that should echo it
      let bestIndex = 0;
      let bestDistance = Infinity;
      repaired.forEach((n, i) => {
        const distance = Math.abs((midiOf(n.pitch) ?? 60) - anchorMidi);
        if (distance < bestDistance) { bestDistance = distance; bestIndex = i; }
      });
      const here = midiOf(repaired[bestIndex]!.pitch) ?? 60;
      // A pitch class is 0-11, so the octave has to be rebuilt around the note being moved: taking the
      // class alone would send an E4 answer to A0.
      const base = Math.round((here - targetPc) / 12) * 12 + targetPc;
      const candidates = [base - 12, base, base + 12];
      const nearest = candidates.reduce((best, c) => (Math.abs(c - here) < Math.abs(best - here) ? c : best), base);
      repaired[bestIndex] = { ...repaired[bestIndex]!, pitch: noteNameFromMidi(nearest) };
      answered = true;
    }
  }

  // SHAPE. One note per pitch per grid slot, in time order.
  const seen = new Set<string>();
  const unique: GeneratedNote[] = [];
  for (const note of repaired.sort((a, b) => a.beatTime - b.beatTime)) {
    const slot = `${note.pitch}@${note.beatTime}`;
    if (seen.has(slot)) { dropped.duplicate++; continue; }
    seen.add(slot);
    unique.push(note);
  }

  // DYNAMICS. Bring the bar to the level the room is playing at.
  //
  // SHIFT, NOT SCALE. A shift moves every note by the same amount, so the accents inside the bar keep
  // their shape and a quiet bar reaches a loud room in ONE step; a ratio cannot, because a whisper
  // multiplied is still a whisper (40 * 2.6 is 104, and the clamp that keeps it from distorting is
  // what stopped it arriving). The cost of shifting is at the ceiling: a bar boosted into 127 loses
  // its top accents, which is the lesser of the two distortions.
  if (options.targetMeanVelocity && unique.length > 0) {
    const target = Math.max(1, Math.min(127, options.targetMeanVelocity));
    const current = unique.reduce((sum, n) => sum + n.velocity, 0) / unique.length;
    const delta = target - current;
    if (Math.abs(delta) > 12) {
      for (const note of unique) {
        const next = Math.max(1, Math.min(127, Math.round(note.velocity + delta)));
        if (next !== note.velocity) dropped.rescaled++;
        note.velocity = next;
      }
    }
  }

  // DENSITY. Keep the earliest notes: a crowded bar should lose its tail, not its downbeat.
  const capped = unique.slice(0, maxNotes);
  dropped.overCap = unique.length - capped.length;

  return { notes: capped, answered, dropped };
}
