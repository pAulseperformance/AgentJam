import { describe, it, expect } from 'vitest';
import { melodyPlan, completeMelody, shapeLine, restateHook, applyContourRules, cadenceLine, cadenceFrom } from './melody';
import { midiOf, isInKey } from '../shared/music/pattern-generator';

const note = (pitch: string, beatTime: number, velocity = 80, duration = 0.25) => ({ pitch, beatTime, velocity, duration });

describe('melodyPlan', () => {
  it('walks a four bar arc: state, restate, develop, cadence', () => {
    expect(melodyPlan(0, 'jazz', false).position).toBe('state');
    expect(melodyPlan(1, 'jazz', true).position).toBe('restate');
    expect(melodyPlan(2, 'jazz', true).position).toBe('develop');
    expect(melodyPlan(3, 'jazz', true).position).toBe('cadence');
    // the fifth bar is the first bar of the next phrase
    expect(melodyPlan(4, 'jazz', true).position).toBe('state');
  });

  it('asks for a line of at least five notes, except the cadence which lands short', () => {
    for (const style of ['ambient', 'jazz', 'random']) {
      for (let bar = 0; bar < 4; bar++) {
        const plan = melodyPlan(bar, style, bar > 0);
        if (plan.position === 'cadence') expect(plan.wantNotes).toBeLessThanOrEqual(3);
        else expect(plan.wantNotes).toBeGreaterThanOrEqual(5);
        expect(plan.instruction).toContain('MELODY');
      }
    }
  });

  it('asks funk for a riff with space around it, not the densest line in the room', () => {
    // FUNK WAS MAPPED TO "MORE NOTES" (seven, then eight, every bar, joined up) and a recorded funk
    // agent played 47 notes in 16 seconds: a wash. A funk part is a short shape with silence around it.
    for (let bar = 0; bar < 4; bar++) {
      const plan = melodyPlan(bar, 'funk', bar > 0);
      expect(plan.wantNotes).toBeLessThanOrEqual(plan.position === 'cadence' ? 3 : 5);
      expect(plan.instruction).toContain('RIFF');
      expect(plan.instruction).toContain('silence');
    }
    expect(melodyPlan(0, 'funk', false).wantNotes).toBeLessThan(melodyPlan(0, 'jazz', false).wantNotes);
  });

  it('uses a wave for a develop bar that has a motif to develop', () => {
    expect(melodyPlan(2, 'jazz', true).contour).toBe('wave');
    expect(melodyPlan(2, 'jazz', false).contour).toBe('rising');
  });
});

describe('completeMelody', () => {
  const plan = melodyPlan(0, 'jazz', false); // 6 notes, arch, first statement

  it('completes a triad into a line instead of leaving three chord tones', () => {
    // the exact bar measured live: E4 C4 G4, an arpeggio, twice in a row
    const { notes, completed, added } = completeMelody(
      [note('E4', 0), note('C4', 1), note('G4', 2)],
      { plan, key: 'C major', motif: null, register: { low: 55, high: 72 } },
    );

    expect(completed).toBe(true);
    expect(added).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThanOrEqual(plan.wantNotes);
    expect(notes.every(n => isInKey(n.pitch, 'C major'))).toBe(true);
    expect(notes.every(n => {
      const m = midiOf(n.pitch);
      return m !== null && m >= 55 && m <= 72;
    })).toBe(true);

    // in time order, and most moves are steps: a line, not a chord
    const midis = notes.map(n => midiOf(n.pitch)!);
    let steps = 0;
    for (let i = 1; i < midis.length; i++) if (Math.abs(midis[i]! - midis[i - 1]!) <= 2) steps++;
    expect(steps / Math.max(1, midis.length - 1)).toBeGreaterThan(0.5);
  });

  it('leaves a bar that is already a line alone', () => {
    const line = [note('C4', 0), note('D4', 0.25), note('E4', 0.5), note('F4', 1), note('G4', 1.5), note('A4', 2)];
    const { notes, completed } = completeMelody(line, {
      plan,
      key: 'C major',
      motif: null,
      register: { low: 55, high: 72 },
    });

    expect(completed).toBe(false);
    expect(notes).toEqual(line);
  });

  it('keeps the motif rhythm on a restate instead of inventing a new one', () => {
    const restate = melodyPlan(1, 'jazz', true);
    const motif = { pitches: ['C4', 'E4', 'G4'], slots: [0, 4, 8] };
    const { notes, completed } = completeMelody([note('C4', 0)], {
      plan: restate,
      key: 'C major',
      motif,
      register: { low: 55, high: 72 },
    });

    expect(completed).toBe(true);
    const addedSlots = notes.map(n => Math.round(n.beatTime * 4));
    expect(addedSlots).toContain(4);
    expect(addedSlots).toContain(8);
  });

  // MEASURED in a recorded public session: eight sixteenths per bar, every one at velocity 100.
  it('gives a flat bar dynamics: a swell to the peak and a taper at the ends', () => {
    const flat = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((p, i) =>
      ({ pitch: p, beatTime: i * 0.25, velocity: 100, duration: 0.25 }));
    const shaped = shapeLine(flat, { contour: 'arch', density: 'dense' });

    const velocities = shaped.map(n => n.velocity);
    const peak = Math.max(...velocities);
    const first = velocities[0]!;
    const last = velocities.at(-1)!;

    // and it BREATHES: two sixteenths in a row is bebop, a third is a metronome
    expect(shaped.length).toBeLessThan(flat.length);
    expect(shaped.length).toBeGreaterThanOrEqual(4);
    let run = 0;
    for (let i = 1; i < shaped.length; i++) {
      const gap = shaped[i]!.beatTime - shaped[i - 1]!.beatTime;
      run = gap <= 0.26 ? run + 1 : 0;
      expect(run).toBeLessThan(2);
    }
    expect(new Set(velocities).size).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(112);
    expect(first).toBeLessThan(peak);
    expect(last).toBeLessThan(peak);
    // and the phrase lands: the final note is held longer than the run
    expect(shaped.at(-1)!.duration).toBeGreaterThan(shaped[0]!.duration);
  });

  it('keeps the notes and their order when shaping', () => {
    const line = [note('G4', 1), note('C4', 0), note('E4', 0.5)];
    const shaped = shapeLine(line, { contour: 'rising', density: 'medium' });
    expect(shaped.map(n => n.pitch)).toEqual(['C4', 'E4', 'G4']);
  });

  it('lands a cadence short instead of padding it back into a line', () => {
    const cadence = melodyPlan(3, 'jazz', true);
    const { notes } = completeMelody([note('C4', 0), note('E4', 1)], {
      plan: cadence,
      key: 'C major',
      motif: null,
      register: { low: 55, high: 72 },
    });
    expect(notes.length).toBeLessThanOrEqual(3);
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });

  it('never exceeds the note ceiling', () => {
    const { notes } = completeMelody([], {
      plan: melodyPlan(2, 'funk', true),
      key: 'C major',
      motif: null,
      register: { low: 55, high: 72 },
      maxNotes: 10,
    });
    expect(notes.length).toBeLessThanOrEqual(10);
    expect(notes.length).toBeGreaterThanOrEqual(5);
  });
});

// RESEARCHED, then measured: Yin-Yang (arXiv 2501.17759) says a motif should come back varied slightly,
// and that blind inversion or retrograde without context is musically nonsensical. One change, not a
// new line.
describe('restateHook', () => {
  const hook = [note('C4', 0, 90), note('E4', 0.5, 100), note('G4', 1.5, 80), note('C5', 2, 70)];

  it('brings the hook back with exactly one change', () => {
    const same = restateHook(hook, { key: 'C major', register: { low: 55, high: 72 }, bar: 0 });
    const changed = same.filter((n, i) => n.pitch !== hook[i]!.pitch);
    expect(same).toHaveLength(hook.length);
    expect(changed).toHaveLength(1);
    expect(isInKey(changed[0]!.pitch, 'C major')).toBe(true);
    // and it keeps the rhythm, so the phrase is recognised
    expect(same.map(n => n.beatTime)).toEqual(hook.map(n => n.beatTime));
  });

  it('moves one slot later on the other variant, and never off the bar', () => {
    const shifted = restateHook(hook, { key: 'C major', register: { low: 55, high: 72 }, bar: 1 });
    const moved = shifted.filter((n, i) => n.beatTime !== hook[i]!.beatTime);
    expect(moved).toHaveLength(1);
    expect(moved[0]!.beatTime).toBeLessThanOrEqual(3.75);
    expect(shifted.map(n => n.pitch)).toEqual(hook.map(n => n.pitch));
  });
});

// Species counterpoint's audible rules: mostly steps, a leap answered by a step the other way,
// never two leaps in the same direction, never the same pitch twice.
describe('applyContourRules', () => {
  const opts = { key: 'C major', register: { low: 55, high: 72 } };

  it('breaks a repeated pitch into a step', () => {
    const stutter = [note('C5', 0), note('C5', 0.5), note('C5', 1), note('C5', 1.5)];
    const fixed = applyContourRules(stutter, opts);
    for (let i = 1; i < fixed.length; i++) {
      expect(fixed[i]!.pitch).not.toBe(fixed[i - 1]!.pitch);
    }
  });

  it('answers a leap with a step instead of another leap in the same direction', () => {
    const leapy = [note('C4', 0), note('G4', 0.5), note('C5', 1), note('E5', 1.5)];
    const fixed = applyContourRules(leapy, opts);
    const midis = fixed.map(n => midiOf(n.pitch)!);
    let leapsInARow = 0;
    let last = 0;
    for (let i = 1; i < midis.length; i++) {
      const move = midis[i]! - midis[i - 1]!;
      const leap = Math.abs(move) >= 4;
      if (leap && last !== 0 && Math.sign(move) === last) leapsInARow++;
      last = leap ? Math.sign(move) : 0;
    }
    expect(leapsInARow).toBe(0);
  });

  it('keeps everything in key and inside the register', () => {
    const wild = [note('C5', 0), note('C5', 0.25), note('B5', 0.5), note('A3', 0.75), note('A3', 1)];
    const fixed = applyContourRules(wild, opts);
    expect(fixed.every(n => isInKey(n.pitch, 'C major'))).toBe(true);
    expect(fixed.every(n => {
      const m = midiOf(n.pitch);
      return m !== null && m >= opts.register.low && m <= opts.register.high;
    })).toBe(true);
  });
});


describe('cadenceLine', () => {
  it('lands on the tonic in two notes, the second held longer', () => {
    const cadence = cadenceLine({ key: 'C major', register: { low: 55, high: 72 }, fromMidi: 64 });
    expect(cadence).toHaveLength(2);
    const last = cadence[1]!;
    expect(((midiOf(last.pitch)! % 12) + 12) % 12).toBe(0); // C is the tonic
    expect(last.duration).toBeGreaterThan(cadence[0]!.duration);
    expect(last.beatTime).toBeGreaterThan(cadence[0]!.beatTime);
  });

  it('approaches the landing by a step, not a jump', () => {
    const cadence = cadenceLine({ key: 'C major', register: { low: 55, high: 72 }, fromMidi: 69 });
    const gap = Math.abs(midiOf(cadence[1]!.pitch)! - midiOf(cadence[0]!.pitch)!);
    expect(gap).toBeLessThanOrEqual(3);
  });
});

/**
 * THE CADENCE KEEPS THE BAR IT LANDS IN.
 *
 * `cadenceLine` replaces the whole bar with the same two notes in the same two slots, and it used to
 * run on every cadence bar. Measured on the 2026-11-01 session: five cadence bars carried 23 model
 * notes and played 10, so thirteen of the model's own notes never sounded there, the pass cost 14 of
 * the 100 notes the pipeline held (9 today), and every ending sounded like the same gesture.
 */
describe('cadenceFrom', () => {
  const register = { low: 55, high: 72 };

  it('keeps a bar that already lands on a chord tone', () => {
    const bar = [note('E4', 0), note('G4', 1), note('C5', 2)];
    const out = cadenceFrom(bar, { key: 'C minor', register });
    expect(out.map(n => `${n.pitch}@${n.beatTime}`)).toEqual(['E4@0', 'G4@1', 'C5@2']);
  });

  it('keeps the model opening and resolves a last note that does not land', () => {
    // D4 is the second degree of C minor: a line stopping there has not landed.
    const bar = [note('E4', 0), note('G4', 1), note('D4', 2)];
    const out = cadenceFrom(bar, { key: 'C minor', register });
    const last = out.at(-1)!;
    const pc = ((midiOf(last.pitch)! % 12) + 12) % 12;
    expect([0, 3, 7]).toContain(pc); // tonic, third or fifth
    // THE OPENING IS NOT REWRITTEN: the first two notes are the model's own.
    expect(out[0]!.pitch).toBe('E4');
    expect(out[0]!.beatTime).toBe(0);
    expect(out[1]!.pitch).toBe('G4');
    // THE RESOLUTION IS A STEP, not a jump to the tonic.
    expect(Math.abs(midiOf(last.pitch)! - midiOf('D4')!)).toBeLessThanOrEqual(2);
  });

  it('never leaves the register the decision named, and keeps the opening note', () => {
    const bar = [note('C5', 0), note('B4', 1), note('D5', 2)];
    const out = cadenceFrom(bar, { key: 'C minor', register });
    for (const n of out) {
      expect(midiOf(n.pitch)!).toBeGreaterThanOrEqual(register.low);
      expect(midiOf(n.pitch)!).toBeLessThanOrEqual(register.high);
    }
    // THE OPENING IS THE MODEL'S, which is what separates this from `cadenceLine`: its fixed gesture
    // starts on A#3 in this register, so the assertion is red with the old pass restored.
    expect(out[0]!.pitch).toBe('C5');
  });

  it('does not accept the key’s OTHER third as a landing', () => {
    // E natural is not a chord tone of C minor, and Eb is not one of C major. The first version's
    // chord-tone set held both thirds, so it returned these bars untouched: a cadence that never
    // landed, queued as if it had.
    const minor = cadenceFrom([note('C4', 0), note('E4', 1), note('E5', 2)], { key: 'C minor', register });
    const minorPc = ((midiOf(minor.at(-1)!.pitch)! % 12) + 12) % 12;
    expect([0, 3, 7]).toContain(minorPc);

    const major = cadenceFrom([note('C4', 0), note('G4', 1), note('Eb4', 2)], { key: 'C major', register });
    const majorPc = ((midiOf(major.at(-1)!.pitch)! % 12) + 12) % 12;
    expect([0, 4, 7]).toContain(majorPc);
  });

  it('never puts the landing on a slot the opening already uses', () => {
    // The model's opening can already reach the end of the bar; the landing takes the last of those
    // notes' slot rather than landing on top of it. Two notes on one beat is a chord in a line.
    const out = cadenceFrom([note('A4', 0.5), note('B4', 3.5), note('D5', 3.75)], { key: 'C minor', register });
    const slots = out.map(n => n.beatTime);
    expect(new Set(slots).size).toBe(out.length);
  });

  it('falls back to the written cadence when the bar is empty', () => {
    const out = cadenceFrom([], { key: 'C minor', register });
    expect(out).toHaveLength(2);
    expect(((midiOf(out[1]!.pitch)! % 12) + 12) % 12).toBe(0); // the tonic
  });
});

// MEASURED in a recorded session: a shifted note landed on the next note's slot, and two notes
// sounded on one beat inside a monophonic line.
describe('restateHook slot collisions', () => {
  it('never puts two notes on one beat', () => {
    const hook = [note('D4', 0.25), note('E4', 0.75), note('B4', 0.5)];
    const out = restateHook(hook, { key: 'C major', register: { low: 55, high: 72 }, bar: 1 });
    const slots = out.map(n => Math.round(n.beatTime * 4));
    expect(new Set(slots).size).toBe(out.length);
  });
});

// MEASURED by a reviewer: in C minor the band 40..59 starts on E2, which is not in the key, so the
// old nearestInKey clamped its answer onto the bound and returned an out-of-key repeated pitch.
describe('contour rules at a register bound', () => {
  it('stays in a minor key when the band edge is not a scale tone', () => {
    const opts = { key: 'C minor', register: { low: 40, high: 59 } };
    const stutter = [note('E2', 0), note('E2', 0.5), note('E2', 1)];
    const fixed = applyContourRules(stutter, opts);
    for (const n of fixed) {
      expect(isInKey(n.pitch, 'C minor')).toBe(true);
      const m = midiOf(n.pitch)!;
      expect(m).toBeGreaterThanOrEqual(40);
      expect(m).toBeLessThanOrEqual(59);
    }
    expect(fixed[1]!.pitch).not.toBe(fixed[0]!.pitch);
  });

  it('clamps a cadence start that sits outside the band it was handed', () => {
    const cadence = cadenceLine({ key: 'C major', register: { low: 40, high: 59 }, fromMidi: 84 });
    for (const n of cadence) {
      const m = midiOf(n.pitch)!;
      expect(m).toBeGreaterThanOrEqual(40);
      expect(m).toBeLessThanOrEqual(59);
    }
  });
});

describe('shapeLine on a landing', () => {
  it('makes the landing the strongest note in a two note cadence', () => {
    const cadence = [note('B4', 0.5, 92), note('C5', 1.5, 76)];
    const shaped = shapeLine(cadence, { contour: 'falling', density: 'medium', meanVelocity: 92 });
    expect(shaped[1]!.velocity).toBeGreaterThan(shaped[0]!.velocity);
  });
});
