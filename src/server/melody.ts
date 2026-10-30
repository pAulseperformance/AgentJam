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
import type { DecisionBrief } from './llm-planner';

type DecisionDensity = DecisionBrief['density'];

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
  // A PHRASE HAS A BEGINNING AND AN END. A recorded 20-bar session had 5 to 7 notes in EVERY bar, no
  // bar under four and no silence anywhere, which is why nothing it plays sounds finished. The
  // statement is the longest bar, the development reaches, and the cadence LANDS: two or three notes
  // and the rest of the bar left open, so the next phrase has somewhere to start.
  const wantNotes = position === 'cadence'
    ? 3
    : Math.max(5, position === 'state' ? base : base + 1);

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

/**
 * COMPLETE THE LINE. Given what the model wrote, return a bar that is a melody: at least `wantNotes`
 * notes, mostly stepwise, inside the register, in key, on the sixteenth grid.
 *
 * It is deliberately additive: a bar that is already a line is returned untouched (a caller comparing
 * lengths sees the same array), because the model's own contours are worth keeping when they exist.
 */
/**
 * SHAPE THE LINE. Measured in a recorded public session: eight sixteenths per bar at a flat velocity
 * 100, every one the same weight, which is a typewriter and not a player. A phrase breathes: it starts
 * softly, swells to the note the line is reaching for, and lets the last note sit.
 *
 * This runs on every bar, after the model and after the completion, because the model has no dynamics
 * worth keeping (a 3B model writes one velocity for the whole bar).
 */
export function shapeLine(
  notes: GeneratedNote[],
  options: { contour: Contour; density: DecisionDensity; meanVelocity?: number },
): GeneratedNote[] {
  if (notes.length === 0) return notes;
  const ordered = notes.slice().sort((a, b) => a.beatTime - b.beatTime);
  const ceiling = Math.max(40, Math.min(110, options.meanVelocity ?? 92));
  // A SHORT BAR IS A LANDING. Measured: a two note cadence came out 92 then 51, so the resolution was
  // the quietest note in the phrase. When there is almost nothing to shape, the last note is the point.
  const peakIndex = ordered.length <= 3
    ? ordered.length - 1
    : options.contour === 'rising'
      ? ordered.length - 1
      : options.contour === 'falling'
        ? 0
        : Math.floor(ordered.length / 2);

  const durationForDensity = options.density === 'sparse' ? 0.5 : options.density === 'medium' ? 0.35 : 0.28;

  // A PHRASE RESTS. Measured across 16 recorded bars: a median gap of 125ms between notes, every bar,
  // which is a sixteenth-note treadmill and the single biggest reason it sounds mechanical. Two
  // sixteenths in a row is bebop; a third is a metronome, so the third is dropped and the bar breathes.
  const kept: GeneratedNote[] = [];
  let run = 0;
  for (const note of ordered) {
    const previous = kept.at(-1);
    const gap = previous ? note.beatTime - previous.beatTime : Infinity;
    if (gap > 0 && gap <= 0.26) {
      run++;
      if (run >= 2 && kept.length < ordered.length - 1) continue; // keep the last note, it is the landing
    } else {
      run = 0;
    }
    kept.push(note);
  }

  return kept.map((note, i) => {
    // distance from the peak, as a share of the line: the swell, then the taper
    const reach = Math.abs(i - peakIndex) / Math.max(1, kept.length - 1);
    const weight = 1 - 0.45 * reach;
    const velocity = Math.round(Math.max(38, Math.min(112, ceiling * weight)));
    // a note on a strong beat is held; the last note of the phrase is held longer, which is what a
    // landing sounds like
    const strongBeat = Math.abs(note.beatTime - Math.round(note.beatTime)) < 0.01;
    const isLast = i === kept.length - 1;
    const duration = isLast ? durationForDensity * 1.8 : strongBeat ? durationForDensity * 1.3 : durationForDensity;
    return { ...note, velocity, duration: Math.round(duration * 100) / 100 };
  });
}

/**
 * THE HOOK COMES BACK. Researched, then measured: Yin-Yang (arXiv 2501.17759) frames motif development as
 * repeat, vary slightly, or depart, and warns that applying transformations blindly (inversion,
 * retrograde, fragmentation) without regard to the preceding context is musically nonsensical, while
 * repeating without change is monotonous. So the restate bar returns the hook with EXACTLY ONE change:
 * one note moved a scale step, or one rhythm slot shifted. Not a new line, and not a copy.
 */
export function restateHook(
  hook: GeneratedNote[],
  options: { key: string; register: { low: number; high: number }; bar: number },
): GeneratedNote[] {
  if (hook.length === 0) return [];
  const copy = hook.map(n => ({ ...n }));

  // which change, chosen by the bar so the same phrase never varies the same way twice in a row
  const variant = options.bar % 2;
  if (variant === 0) {
    // move ONE note a scale step, preferring the note furthest from the hook's own centre
    const midis = copy.map(n => midiOf(n.pitch) ?? 60);
    const centre = midis.reduce((a, b) => a + b, 0) / midis.length;
    let index = 0;
    let distance = -1;
    midis.forEach((m, i) => {
      const d = Math.abs(m - centre);
      if (d > distance) { distance = d; index = i; }
    });
    const target = copy[index]!;
    const midi = midis[index]!;
    const allowed = scalePitchClasses(options.key);
    for (const direction of [1, -1]) {
      for (const step of [1, 2, 3]) {
        const candidate = midi + direction * step;
        if (!allowed.includes(((candidate % 12) + 12) % 12)) continue;
        if (candidate < options.register.low || candidate > options.register.high) continue;
        copy[index] = { ...target, pitch: noteNameFromMidi(candidate) };
        return copy;
      }
    }
    return copy;
  }

  // shift ONE rhythm slot, to a slot NOBODY ELSE IS IN. Measured: shifting the last note onto the
  // next note's slot put two notes on one beat (E4 and B4 at 0.75), which is a chord in a line.
  const used = new Set(copy.map(n => Math.round(n.beatTime * 4)));
  const index = copy.length - 1;
  const last = copy[index]!;
  const current = Math.round(last.beatTime * 4);
  for (const delta of [1, 2, 3, -1, -2]) {
    const slot = current + delta;
    if (slot < 0 || slot > 15 || used.has(slot)) continue;
    copy[index] = { ...last, beatTime: slot / 4 };
    return copy;
  }
  return copy;
}

/**
 * THE CONTOUR RULES. Species counterpoint's oldest and most audible ones, from the cantus firmus
 * literature: motion is mostly stepwise, a leap of a fourth or more must be answered by a step in the
 * OPPOSITE direction, two leaps in the same direction in a row are wrong, and the same pitch twice in a
 * row is a stutter. Measured before: a leap was as likely as a step, and one bar repeated C5 four times.
 *
 * This repairs rather than rejects: it moves the offending note to the nearest in-key pitch that
 * satisfies the rule, inside the register the decision named.
 */
export function applyContourRules(
  notes: GeneratedNote[],
  options: { key: string; register: { low: number; high: number } },
): GeneratedNote[] {
  if (notes.length < 2) return notes;
  const allowed = scalePitchClasses(options.key);
  const clamp = (m: number) => Math.max(options.register.low, Math.min(options.register.high, m));
  const nearestInKey = (from: number, target: number, direction: 1 | -1): number => {
    let midi = from;
    for (let guard = 0; guard < 12; guard++) {
      midi += direction;
      if (allowed.includes(((midi % 12) + 12) % 12)) {
        if (Math.abs(midi - target) <= 6) return clamp(midi);
      }
    }
    return clamp(from + direction * 2);
  };

  const out: GeneratedNote[] = [{ ...notes[0]! }];
  let lastLeapDirection = 0;

  for (let i = 1; i < notes.length; i++) {
    const note = notes[i]!;
    const previous = out[out.length - 1]!;
    const prevMidi = midiOf(previous.pitch) ?? 60;
    let midi = midiOf(note.pitch) ?? prevMidi;
    const move = midi - prevMidi;
    const isLeap = Math.abs(move) >= 4;

    if (move === 0) {
      // a repeated pitch is a stutter: step off it, in the direction that has room. Stepping up at the
      // top of the register only clamped back onto the same pitch, which the test caught.
      const up = prevMidi + 2 <= options.register.high;
      midi = nearestInKey(prevMidi, up ? midi + 1 : midi - 1, up ? 1 : -1);
    } else if (lastLeapDirection !== 0 && isLeap && Math.sign(move) === lastLeapDirection) {
      // two leaps in the same direction: answer the second one with a step back
      midi = nearestInKey(prevMidi, midi, lastLeapDirection === 1 ? -1 : 1);
    }

    lastLeapDirection = Math.abs(midi - prevMidi) >= 4 ? Math.sign(midi - prevMidi) : 0;
    out.push({ ...note, pitch: noteNameFromMidi(clamp(midi)) });
  }

  return out;
}

/**
 * THE CADENCE LANDS. Two or three notes, the last one approached by step and on the tonic if the line
 * can reach it, held longer than anything else in the phrase, and the rest of the bar left open.
 */
export function cadenceLine(
  options: { key: string; register: { low: number; high: number }; fromMidi?: number },
): GeneratedNote[] {
  const allowed = scalePitchClasses(options.key);
  const tonic = allowed[0] ?? 0;
  const from = options.fromMidi ?? Math.round((options.register.low + options.register.high) / 2);

  // the nearest tonic to where the line already is, so the landing is a step and not a jump
  let landing = from;
  for (let d = 0; d <= 12; d++) {
    for (const candidate of [from - d, from + d]) {
      if (candidate < options.register.low || candidate > options.register.high) continue;
      if (((candidate % 12) + 12) % 12 === tonic) { landing = candidate; d = 13; break; }
    }
  }

  const approach = nearestInKeyBelow(allowed, landing, options.register);
  return [
    { pitch: noteNameFromMidi(approach), beatTime: 0.5, velocity: 84, duration: 0.5 },
    { pitch: noteNameFromMidi(landing), beatTime: 1.5, velocity: 76, duration: 1.5 },
  ];
}

function nearestInKeyBelow(allowed: number[], target: number, register: { low: number; high: number }): number {
  for (let d = 1; d <= 6; d++) {
    const candidate = target - d;
    if (candidate < register.low) break;
    if (allowed.includes(((candidate % 12) + 12) % 12)) return candidate;
  }
  return Math.max(register.low, target - 2);
}

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

  // A LINE THAT CANNOT GO FURTHER TURNS AROUND. Clamping at the top of the register produced four
  // C5s in a row in a recorded session: the walk wanted to ascend and the band said no, so it repeated
  // itself. The walk now bounces, which is what a player does at the edge of their range.
  const added: GeneratedNote[] = [];
  let midi = seedMidi;
  let dir: 1 | -1 = direction;
  let inKey = scalePitchClasses(key);
  let lastAdded: number | null = null;

  for (const slot of freeSlots) {
    const advance = 1 + (added.length % 2);
    let moved = 0;
    while (moved < advance) {
      midi += dir;
      if (inKey.includes(((midi % 12) + 12) % 12)) moved++;
      if (midi >= register.high) { midi = register.high; dir = -1; }
      else if (midi <= register.low) { midi = register.low; dir = 1; }
    }
    // never the same pitch twice in a row: a repeated note is a stutter, not a step
    if (lastAdded !== null && midi === lastAdded) {
      midi += dir * 2;
      midi = Math.max(register.low, Math.min(register.high, midi));
      const snapped = inKey.includes(((midi % 12) + 12) % 12) ? midi : midi - dir;
      midi = Math.max(register.low, Math.min(register.high, snapped));
    }
    lastAdded = midi;
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
