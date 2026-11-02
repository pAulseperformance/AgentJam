import { z } from 'zod';
import { presetById, type PresetId } from './presets';

/**
 * A PATCH IS THE INSTRUMENT, not a pointer to one.
 *
 * The room used to name an instrument by id, which is enough to pick a preset and useless for changing
 * one: there was nowhere to put a cutoff, an envelope or a unison stack, so "modify the waveform" had no
 * field to modify. A patch carries the whole voice, so the panel can edit it, the server can hold it per
 * agent, and every listener's engine builds the same sound from the same numbers.
 *
 * Everything here is DATA. No Web Audio object appears in this file, so the server can validate a patch a
 * browser sends and a test can check the defaults without a browser.
 */
export const WAVE_SHAPES = ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'fatsawtooth'] as const;
export type WaveShape = (typeof WAVE_SHAPES)[number];

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

export const PatchSchema = z.object({
  /** the preset this patch started from, so the card can still say what it sounds like */
  base: z.string().max(40),
  wave: z.enum(WAVE_SHAPES),
  /** a stacked, detuned oscillator bank: 1 is a plain wave, 5 is a wide unison */
  voices: z.number().int().min(1).max(5),
  detune: z.number().min(0).max(60),
  /** whole octaves, so a part can be moved without retuning the room */
  octave: z.number().int().min(-2).max(2),
  filter: z.object({
    type: z.enum(FILTER_TYPES),
    /** hertz */
    cutoff: z.number().min(80).max(12000),
    resonance: z.number().min(0).max(12),
  }),
  env: z.object({
    /** seconds */
    attack: z.number().min(0.001).max(4),
    decay: z.number().min(0.01).max(4),
    /** 0 to 1 */
    sustain: z.number().min(0).max(1),
    release: z.number().min(0.01).max(6),
  }),
  lfo: z.object({
    /** hertz */
    rate: z.number().min(0.05).max(14),
    /** 0 to 1, mapped onto vibrato depth */
    depth: z.number().min(0).max(1),
  }),
  chorus: z.number().min(0).max(1),
  drive: z.number().min(0).max(1),
  /** decibels */
  level: z.number().min(-30).max(0),
});

export type Patch = z.infer<typeof PatchSchema>;

/** Map a patch onto the `fat*` family when it is stacked, so unison is one oscillator bank. */
export function oscillatorOf(patch: Patch): { type: string; count?: number; spread?: number } {
  if (patch.voices > 1) {
    const family = patch.wave === 'fatsawtooth' ? 'sawtooth' : patch.wave;
    return { type: `fat${family}`, count: patch.voices, spread: patch.detune };
  }
  return { type: patch.wave };
}

/** The options `new Tone.PolySynth(SynthClass, options)` takes, built from a patch. */
export function polyOptionsOf(patch: Patch): Record<string, unknown> {
  return {
    oscillator: oscillatorOf(patch),
    envelope: {
      attack: patch.env.attack,
      decay: patch.env.decay,
      sustain: patch.env.sustain,
      release: patch.env.release,
    },
    detune: patch.octave * 1200,
  };
}

/** A patch's starting point from a preset, so the panel always opens on something that sounds good. */
export function patchFromPreset(id: PresetId): Patch {
  const preset = presetById(id);
  const osc = (preset?.options?.oscillator ?? { type: 'triangle' }) as { type?: string };
  const wave = (osc.type ?? 'triangle') as string;
  const env = (preset?.options?.envelope ?? {}) as { attack?: number; decay?: number; sustain?: number; release?: number };
  const isFat = wave.startsWith('fat');
  return PatchSchema.parse({
    base: id,
    wave: isFat ? (wave.slice(3) as WaveShape) : (WAVE_SHAPES.includes(wave as WaveShape) ? wave : 'triangle'),
    voices: isFat ? 3 : 1,
    detune: isFat ? 12 : 0,
    octave: 0,
    filter: {
      type: preset?.filter?.type ?? 'lowpass',
      cutoff: preset?.filter?.frequency ?? 12000,
      resonance: preset?.filter?.Q ?? 0.7,
    },
    env: {
      attack: env.attack ?? 0.01,
      decay: env.decay ?? 0.3,
      sustain: env.sustain ?? 0.4,
      release: env.release ?? 0.8,
    },
    lfo: {
      rate: preset?.vibrato?.frequency ?? 5,
      depth: preset?.vibrato?.wet ?? 0,
    },
    chorus: preset?.chorus?.wet ?? 0,
    drive: preset?.distortion?.wet ?? 0,
    level: preset?.volume ?? -6,
  });
}

/** The patch a player gets when nothing has been chosen: the seat's preset, as a patch. */
export function defaultPatchFor(id: PresetId): Patch {
  return patchFromPreset(id);
}
