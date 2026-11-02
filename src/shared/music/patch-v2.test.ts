import { describe, expect, it } from 'vitest';
import {
  FLAT_EQ,
  IDLE_MODS,
  PatchSchema,
  normalizePatch,
  patchFromPreset,
  polyOptionsOf,
} from '@/shared/music/patch';
import { PRESET_IDS } from '@/shared/music/presets';

/**
 * THE PANEL'S HALF OF THE CONTRACT, as data.
 *
 * A synth surface is only honest if the numbers behind it are: a patch written before the equaliser and the
 * modulators existed must still parse and must still sound the same, a patch written now must carry its two
 * modulators and its EQ, and the engine's oscillator options must follow the knobs rather than a default.
 */
describe('patch v2', () => {
  it('reads a patch written before the EQ and the modulators, and fills them in', () => {
    // exactly the shape the previous deploy sent: no sub, no glide, no eq, no mods, one lfo
    const old = {
      base: 'juno-pad',
      wave: 'sawtooth' as const,
      voices: 3,
      detune: 12,
      octave: 0,
      filter: { type: 'lowpass' as const, cutoff: 1400, resonance: 1.2 },
      env: { attack: 0.9, decay: 1.2, sustain: 0.7, release: 2.6 },
      lfo: { rate: 5.5, depth: 0.3 },
      chorus: 0.6,
      drive: 0,
      level: -14,
    };
    const parsed = PatchSchema.parse(old);
    expect(parsed.sub, 'a missing sub is silent, not undefined').toBe(0);
    expect(parsed.glide).toBe(0);

    const full = normalizePatch(parsed);
    expect(full.eq).toEqual(FLAT_EQ);
    expect(full.mods[0], 'the old vibrato becomes modulator one').toEqual({ shape: 'sine', rate: 5.5, depth: 0.3, target: 'pitch' });
    expect(full.mods[1]).toEqual(IDLE_MODS[1]);
  });

  it('carries two modulators with a destination each', () => {
    const patch = patchFromPreset('juno-pad');
    expect(patch.mods).toHaveLength(2);
    for (const mod of patch.mods!) {
      expect(['pitch', 'filter', 'level']).toContain(mod.target);
      expect(mod.rate).toBeGreaterThan(0);
    }
    // a destination the engine cannot route is refused rather than defaulted
    const broken = { ...patch, mods: [{ ...patch.mods![0], target: 'pan' }, patch.mods![1]] };
    expect(PatchSchema.safeParse(broken).success).toBe(false);
  });

  it('refuses an equaliser past its range, and accepts one at the edge', () => {
    const patch = patchFromPreset('brass');
    expect(PatchSchema.safeParse({ ...patch, eq: { ...FLAT_EQ, low: 12 } }).success).toBe(true);
    expect(PatchSchema.safeParse({ ...patch, eq: { ...FLAT_EQ, low: 30 } }).success).toBe(false);
    expect(PatchSchema.safeParse({ ...patch, eq: { ...FLAT_EQ, lowFreq: 20 } }).success).toBe(false);
  });

  it('every factory patch is valid and carries the new sections', () => {
    for (const id of PRESET_IDS) {
      const patch = patchFromPreset(id);
      expect(PatchSchema.safeParse(patch).success, `${id} is a valid patch`).toBe(true);
      expect(patch.eq, `${id} has an equaliser slot`).toBeTruthy();
      const full = normalizePatch(patch);
      expect(full.mods).toHaveLength(2);
    }
  });

  it('maps the oscillator knobs onto the engine options', () => {
    const base = patchFromPreset('brass');
    const stacked = polyOptionsOf({ ...base, voices: 4, detune: 22, wave: 'sawtooth' }) as { oscillator: { type: string; count?: number; spread?: number } };
    expect(stacked.oscillator).toEqual({ type: 'fatsawtooth', count: 4, spread: 22 });
    const single = polyOptionsOf({ ...base, voices: 1, wave: 'square' }) as { oscillator: { type: string } };
    expect(single.oscillator.type).toBe('square');
    // glide reaches the engine as portamento, and only when it is asked for
    expect((polyOptionsOf({ ...base, glide: 0.2 }) as { portamento?: number }).portamento).toBe(0.2);
    expect((polyOptionsOf({ ...base, glide: 0 }) as { portamento?: number }).portamento).toBeUndefined();
  });
});
