/**
 * ONE TONAL CENTRE FOR THE ROOM, AND THE BAR THAT MOVES IT LEAST.
 *
 * Three agents each write their own line against the room's key, and each one's line is consonant
 * with the key and not necessarily with the other two. Measured on the live room at 160 BPM with
 * jazz, funk and ambient (probe-session.mjs, 45 s, 84 agent bars), 17 slots held two agents a
 * semitone apart: E under F, B under C, the one interval the band cannot agree on.
 *
 * So the room keeps one centre for the SESSION, computed from every agent's recent notes rather
 * than from each agent's own phrase, and when two candidate bars exist for the same slot it keeps
 * the one whose pitch classes stay closest to that centre. A bar that would put two agents a
 * semitone apart in the same slot is never the preferred one.
 *
 * Pure on purpose: a centre is a vote over pitches, a clash is a slot and a pitch class, and a
 * choice between bars is a comparison. Nothing here reads the clock or the room, so the same
 * candidates and the same centre decide the same bar.
 */
import { pitchClassOf } from '@/shared/music';

/** HOW MANY BARS BACK THE CENTRE LISTENS. The room's phrase is four bars, so two phrases. */
export const CENTRE_WINDOW_BARS = 8;

/** A note as a comparison sees it: a pitch and the slot it sits on. */
export interface PitchPoint {
  pitch: string;
  beatTime: number;
}

/** Pitch classes wrap: 11 and 0 are a semitone apart, not eleven. */
function wrap12(value: number): number {
  return ((Math.round(value) % 12) + 12) % 12;
}

/**
 * HOW FAR APART TWO PITCH CLASSES ARE, on the circle: 0 is the same class in any octave, 1 is a
 * semitone, 6 is the tritone, and it never exceeds 6. This is the only distance the room uses for
 * a centre: two notes an octave apart are the same class, and a B under a C is a semitone whatever
 * octaves they are written in.
 */
export function pitchClassDistance(a: number, b: number): number {
  const raw = Math.abs(wrap12(a) - wrap12(b));
  return Math.min(raw, 12 - raw);
}

/**
 * THE ROOM'S ONE TONAL CENTRE.
 *
 * `agentsNotes` is one list per agent: everything that agent has played recently. Each AGENT votes
 * once, however busy its bar was: its pitch classes are counted and normalised to its own busiest
 * class, so a bar of twelve notes and a bar of two carry the same voice. A centre counted in raw
 * notes is the loudest agent's centre, which is the failure this exists to stop, and one agent
 * playing the tonic over two others on the fifth must not be outvoted by its own density.
 *
 * The busiest class wins. A tie goes to the class nearest the room's `tonic` (the key every agent
 * is already told to play in), then to the lower class. With no notes at all there is nothing to
 * hear and the centre is the tonic.
 */
export function roomCentre(agentsNotes: ReadonlyArray<ReadonlyArray<string>>, tonic: number): number {
  const votes = new Array<number>(12).fill(0);
  let heard = 0;
  for (const notes of agentsNotes) {
    const own = new Array<number>(12).fill(0);
    let played = 0;
    for (const pitch of notes) {
      const pc = pitchClassOf(pitch);
      if (pc === null) continue;
      own[pc] = own[pc]! + 1;
      played += 1;
    }
    if (played === 0) continue;
    heard += 1;
    const peak = Math.max(...own);
    for (let pc = 0; pc < 12; pc++) votes[pc] = votes[pc]! + own[pc]! / peak;
  }
  if (heard === 0) return wrap12(tonic);

  const home = wrap12(tonic);
  let best = -1;
  let bestVote = 0;
  let bestTie = 12;
  for (let pc = 0; pc < 12; pc++) {
    const vote = votes[pc]!;
    if (vote <= 0) continue;
    const tie = pitchClassDistance(pc, home);
    const better = best < 0
      || vote > bestVote
      || (vote === bestVote && tie < bestTie);
    if (better) {
      best = pc;
      bestVote = vote;
      bestTie = tie;
    }
  }
  return best < 0 ? home : best;
}

/**
 * HOW NEAR A BAR SITS TO THE CENTRE: the mean circular distance of its pitch classes, in semitones.
 * Lower is closer. A mean, not a sum, so a longer bar does not lose to a shorter one for being
 * longer: "closest" is a property of where the notes are, not of how many there are. A bar with no
 * readable note has no distance to measure and scores 0.
 */
export function centreDistance(notes: ReadonlyArray<{ pitch: string }>, centre: number): number {
  let total = 0;
  let counted = 0;
  for (const note of notes) {
    const pc = pitchClassOf(note.pitch);
    if (pc === null) continue;
    total += pitchClassDistance(pc, wrap12(centre));
    counted += 1;
  }
  return counted === 0 ? 0 : total / counted;
}

/** A note of one bar that would land a semitone from another agent's note in the same slot. */
export interface Clash {
  note: PitchPoint;
  against: PitchPoint;
}

/** The room writes on quarter-beat slots, so two beat times in the same quarter are the same slot. */
function slotOf(beatTime: number): number {
  return Math.round((Number.isFinite(beatTime) ? beatTime : 0) * 4);
}

/**
 * THE NOTES THAT WOULD CLASH. A clash is two agents in the SAME slot whose pitch classes are a
 * semitone apart: not the same pitch (the room already drops a shared pitch), but the one interval
 * no amount of voice leading can put in two voices at once. The same pitch class an octave apart is
 * a doubling, not a clash, so only distance 1 counts.
 */
export function clashesWith(
  notes: ReadonlyArray<PitchPoint>,
  others: ReadonlyArray<PitchPoint>,
): Clash[] {
  const found: Clash[] = [];
  if (others.length === 0) return found;
  for (const note of notes) {
    const pc = pitchClassOf(note.pitch);
    if (pc === null) continue;
    for (const other of others) {
      if (slotOf(note.beatTime) !== slotOf(other.beatTime)) continue;
      const otherPc = pitchClassOf(other.pitch);
      if (otherPc === null) continue;
      if (pitchClassDistance(pc, otherPc) === 1) {
        found.push({ note, against: other });
        break;
      }
    }
  }
  return found;
}

/** What a choice needs to know: where the room's centre is, and what the rest of the room holds. */
export interface BarChoice {
  centre: number;
  /** the other agents' notes already queued or sounding in this slot, which a bar must not clash with */
  others?: ReadonlyArray<PitchPoint>;
}

/**
 * WHICH CANDIDATE BAR THE ROOM KEEPS, as an index into `candidates`.
 *
 * Ranked on two things, in this order:
 * 1. the number of notes that would put two agents a semitone apart in the same slot: a bar that
 *    does that is never the preferred one, whatever else it buys
 * 2. the mean distance of its pitch classes to the room's tonal centre, lower first: the bar that
 *    moves the room least
 *
 * A tie on both keeps the LATER candidate, because the newer one is a refresh written against newer
 * ears and replacing an equally good bar is what a refresh is for.
 */
export function preferredBar(
  candidates: ReadonlyArray<ReadonlyArray<PitchPoint>>,
  choice: BarChoice,
): number {
  const others = choice.others ?? [];
  let best = 0;
  let bestClash = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i++) {
    const clash = clashesWith(candidates[i]!, others).length;
    const distance = centreDistance(candidates[i]!, choice.centre);
    if (clash < bestClash
      || (clash === bestClash && distance < bestDistance)
      || (clash === bestClash && distance === bestDistance && i > best)) {
      best = i;
      bestClash = clash;
      bestDistance = distance;
    }
  }
  return best;
}
