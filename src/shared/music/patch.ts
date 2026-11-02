import { z } from 'zod';
import { presetById, type PresetId } from './presets';

/**
 * A PATCH IS THE INSTRUMENT, not a pointer to one.
 *
 * The first version carried a wave, one envelope and one filter: enough to change a preset's colour, not
 * enough to be a synth. No equaliser, one modulator with one fixed destination, no sub, no glide. This is
 * the surface a person expects from a hardware synth or a plugin, section by section, and every field is
 * DATA so the server can validate what a browser sends and a test can check defaults without a browser.
 *
 * NEW FIELDS ARE DEFAULTED, not required: a patch written by the previous deploy still parses, so a page
 * and a room running a version apart do not disagree about what a voice is.
 */
export const WAVE_SHAPES = ['sine', 'triangle', 'sawtooth', 'square', 'pulse', 'fatsawtooth'] as const;
export type WaveShape = (typeof WAVE_SHAPES)[number];

export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'] as const;
export type FilterType = (typeof FILTER_TYPES)[number];

export const MOD_SHAPES = ['sine', 'triangle', 'square', 'sawtooth'] as const;
export type ModShape = (typeof MOD_SHAPES)[number];

/** Where a modulator sends its movement. */
export const MOD_TARGETS = ['pitch', 'filter', 'level'] as const;
export type ModTarget = (typeof MOD_TARGETS)[number];

/**
 * TWO MODULATORS, each with its own shape, rate, depth and DESTINATION.
 *
 * A single fixed vibrato was the whole of the modulation on offer, so a wobble on the filter and a tremolo
 * on the level were both unreachable. Two slots with a destination each is what a real panel gives you: one
 * slow and wide for movement, one fast and shallow for character.
 */
export const ModSchema = z.object({
  shape: z.enum(MOD_SHAPES),
  /** hertz */
  rate: z.number().min(0.02).max(16),
  /** 0 to 1, scaled per destination: pitch to a semitone, filter to four octaves, level to full depth */
  depth: z.number().min(0).max(1),
  target: z.enum(MOD_TARGETS),
});
export type Mod = z.infer<typeof ModSchema>;

/**
 * A THREE BAND EQUALISER on the voice, before the effects.
 *
 * It is the difference between "a saw" and "a saw that sits in a mix": without it the only tone control is
 * the filter, which takes the top away instead of shaping it.
 */
export const EqSchema = z.object({
  /** low shelf, decibels */
  low: z.number().min(-18).max(18),
  /** bell around the mid band, decibels */
  mid: z.number().min(-18).max(18),
  /** high shelf, decibels */
  high: z.number().min(-18).max(18),
  /** where the low shelf stops and the mid begins, hertz */
  lowFreq: z.number().min(60).max(600),
  /** where the mid ends and the high shelf begins, hertz */
  highFreq: z.number().min(1200).max(8000),
});
export type Eq = z.infer<typeof EqSchema>;

export const PatchSchema = z.object({
  /** the preset this patch started from, so the card can still say what it sounds like */
  base: z.string().max(40),
  wave: z.enum(WAVE_SHAPES),
  /** a stacked, detuned oscillator bank: 1 is a plain wave, 5 is a wide unison */
  voices: z.number().int().min(1).max(5),
  detune: z.number().min(0).max(60),
  /** whole octaves, so a part can be moved without retuning the room */
  octave: z.number().int().min(-2).max(2),
  /** a sub oscillator an octave down, 0 to 1: what gives a patch weight under the hand */
  sub: z.number().min(0).max(1).default(0),
  /** glide between notes, seconds */
  glide: z.number().min(0).max(1).default(0),
  filter: z.object({
    type: z.enum(FILTER_TYPES),
    /** hertz */
    cutoff: z.number().min(80).max(12000),
    resonance: z.number().min(0).max(12),
  }),
  /** the amplifier's envelope: the shape of one note */
  env: z.object({
    attack: z.number().min(0.001).max(4),
    decay: z.number().min(0.01).max(4),
    sustain: z.number().min(0).max(1),
    release: z.number().min(0.01).max(6),
  }),
  /** legacy single vibrato, folded into mods[0] on read so an older patch still sounds the same */
  lfo: z.object({ rate: z.number().min(0.02).max(16), depth: z.number().min(0).max(1) }).optional(),
  mods: z.array(ModSchema).length(2).optional(),
  eq: EqSchema.optional(),
  chorus: z.number().min(0).max(1),
  drive: z.number().min(0).max(1),
  /** decibels */
  level: z.number().min(-30).max(6),
});

export type Patch = z.infer<typeof PatchSchema>;

/** The default equaliser: flat, so a patch that never opened the EQ sounds like itself. */
export const FLAT_EQ: Eq = { low: 0, mid: 0, high: 0, lowFreq: 220, highFreq: 3200 };

/** Two modulators, both silent, so every patch has the slots the panel draws. */
export const IDLE_MODS: [Mod, Mod] = [
  { shape: 'sine', rate: 5, depth: 0, target: 'pitch' },
  { shape: 'triangle', rate: 0.6, depth: 0, target: 'filter' },
];

export type FullPatch = Patch & { sub: number; glide: number; eq: Eq; mods: [Mod, Mod] };

/**
 * FILL IN WHAT A PATCH DOES NOT SAY. A patch written by the previous deploy has no equaliser, no sub and no
 * modulators; normalising it here means ONE code path builds a voice, and a room is never half on the old
 * shape while half is on the new one.
 */
export function normalizePatch(patch: Patch): FullPatch {
  const mods: [Mod, Mod] = patch.mods
    ? [patch.mods[0]! as Mod, patch.mods[1]! as Mod]
    : patch.lfo
      ? [{ shape: 'sine', rate: patch.lfo.rate, depth: patch.lfo.depth, target: 'pitch' }, IDLE_MODS[1]]
      : IDLE_MODS;
  return { ...patch, sub: patch.sub ?? 0, glide: patch.glide ?? 0, eq: patch.eq ?? FLAT_EQ, mods };
}

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
  const options: Record<string, unknown> = {
    oscillator: oscillatorOf(patch),
    envelope: {
      attack: patch.env.attack,
      decay: patch.env.decay,
      sustain: patch.env.sustain,
      release: patch.env.release,
    },
    detune: patch.octave * 1200,
  };
  if (patch.glide && patch.glide > 0.001) options.portamento = patch.glide;
  return options;
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
    sub: 0,
    glide: 0,
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
    lfo: { rate: preset?.vibrato?.frequency ?? 5, depth: preset?.vibrato?.wet ?? 0 },
    mods: [
      { shape: 'sine', rate: preset?.vibrato?.frequency ?? 5, depth: preset?.vibrato?.wet ?? 0, target: 'pitch' },
      IDLE_MODS[1],
    ],
    eq: FLAT_EQ,
    chorus: preset?.chorus?.wet ?? 0,
    drive: preset?.distortion?.wet ?? 0,
    level: preset?.volume ?? -6,
  });
}

/** The patch a player gets when nothing has been chosen: the seat's preset, as a patch. */
export function defaultPatchFor(id: PresetId): Patch {
  return patchFromPreset(id);
}

/** A short name for a patch's home preset, for the card and the saved list. */
export function patchLabel(patch: Patch): string {
  return presetById(patch.base)?.label ?? patch.base;
}
