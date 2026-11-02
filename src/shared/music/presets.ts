/**
 * EVERY PLAYER COMES WITH AN INSTRUMENT, AND THE INSTRUMENT IS A PATCH.
 *
 * The room used to offer six voices that were really six Tone.js classes: "Classic", "AM Synth", "FM
 * Synth". Those are engines, not instruments. An electric piano and a glass pad are both a polyphonic
 * synth underneath, and the difference a listener hears is the oscillator stack, the envelope, the
 * filter and the movement: the patch, not the class.
 *
 * So a preset here is a whole patch on an open-source polyphonic engine (Tone.js, MIT, one PolySynth
 * per player, so a bot can hold a chord). A style row and a seat each name one, a new bot is born with
 * the seat's preset already attached, and the card shows the instrument by name.
 *
 * Nothing in this file touches Web Audio: it is data, so the server can validate a spawn against it and
 * a test can check every style's instrument exists without a browser.
 */
export type PresetFamily = 'keys' | 'pad' | 'lead' | 'bass' | 'pluck' | 'kit';

/** The Tone.js class a patch is built on. `kit` is the room's own drum map, not a pitched synth. */
export type PresetSynth = 'Synth' | 'AMSynth' | 'FMSynth' | 'MembraneSynth' | 'PluckSynth' | 'kit';

/**
 * THE ID SET IS THE WIRE CONTRACT, so it is a literal tuple and not derived: a preset added to the array
 * without its id in this list is a type error rather than a voice the server silently refuses.
 */
export const PRESET_IDS = [
  'electric-piano',
  'reed-piano',
  'juno-pad',
  'glass-pad',
  'string-machine',
  'brass',
  'square-lead',
  'sub-bass',
  'rubber-bass',
  'nylon-pluck',
  'marimba',
  'drum-kit',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetPatch {
  readonly id: PresetId;
  readonly label: string;
  readonly icon: string;
  readonly family: PresetFamily;
  readonly synth: PresetSynth;
  /** passed straight to `new Tone.PolySynth(<class>, options)` */
  readonly options: Record<string, unknown>;
  readonly filter?: { readonly type: BiquadFilterType; readonly frequency: number; readonly Q: number };
  readonly chorus?: { readonly frequency: number; readonly delayTime: number; readonly depth: number; readonly wet: number };
  readonly vibrato?: { readonly frequency: number; readonly depth: number; readonly wet: number };
  readonly distortion?: { readonly distortion: number; readonly wet: number };
  /** decibels, before the player's own volume control */
  readonly volume?: number;
}

/**
 * THE PATCHES. Six families, twelve instruments, ordered as a person would look for them: keys, pads,
 * leads, basses, plucks, then the kit.
 */
export const PRESETS: readonly PresetPatch[] = [
  {
    id: 'electric-piano',
    label: 'Electric Piano',
    icon: '🎹',
    family: 'keys',
    synth: 'FMSynth',
    options: {
      harmonicity: 2,
      modulationIndex: 6,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.005, decay: 1.1, sustain: 0.12, release: 1.1 },
      modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0.05, release: 0.4 },
    },
    chorus: { frequency: 1.2, delayTime: 3, depth: 0.35, wet: 0.35 },
    volume: -6,
  },
  {
    id: 'reed-piano',
    label: 'Reed Piano',
    icon: '🎹',
    family: 'keys',
    synth: 'AMSynth',
    options: {
      harmonicity: 3.2,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.7, sustain: 0.22, release: 0.5 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.4 },
    },
    vibrato: { frequency: 5.2, depth: 0.08, wet: 0.5 },
    volume: -7,
  },
  {
    id: 'juno-pad',
    label: 'Juno Pad',
    icon: '🌫',
    family: 'pad',
    synth: 'Synth',
    options: {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
      envelope: { attack: 0.9, decay: 1.2, sustain: 0.7, release: 2.6 },
    },
    filter: { type: 'lowpass', frequency: 1400, Q: 1.2 },
    chorus: { frequency: 0.7, delayTime: 4, depth: 0.5, wet: 0.6 },
    volume: -14,
  },
  {
    id: 'glass-pad',
    label: 'Glass Pad',
    icon: '🌫',
    family: 'pad',
    synth: 'FMSynth',
    options: {
      harmonicity: 1.5,
      modulationIndex: 12,
      oscillator: { type: 'sine' },
      modulation: { type: 'triangle' },
      envelope: { attack: 1.4, decay: 2, sustain: 0.8, release: 3.2 },
      modulationEnvelope: { attack: 1.8, decay: 2.4, sustain: 0.6, release: 3 },
    },
    filter: { type: 'lowpass', frequency: 2600, Q: 0.7 },
    volume: -16,
  },
  {
    id: 'string-machine',
    label: 'String Machine',
    icon: '🎻',
    family: 'pad',
    synth: 'Synth',
    options: {
      oscillator: { type: 'fatsawtooth', count: 5, spread: 34 },
      envelope: { attack: 0.55, decay: 0.9, sustain: 0.85, release: 2.2 },
    },
    filter: { type: 'lowpass', frequency: 2100, Q: 0.8 },
    chorus: { frequency: 0.9, delayTime: 5, depth: 0.55, wet: 0.55 },
    volume: -15,
  },
  {
    id: 'brass',
    label: 'Synth Brass',
    icon: '🎺',
    family: 'lead',
    synth: 'Synth',
    options: {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
      envelope: { attack: 0.08, decay: 0.5, sustain: 0.45, release: 0.5 },
    },
    filter: { type: 'lowpass', frequency: 1900, Q: 2.2 },
    distortion: { distortion: 0.1, wet: 0.25 },
    volume: -12,
  },
  {
    id: 'square-lead',
    label: 'Square Lead',
    icon: '🔺',
    family: 'lead',
    synth: 'Synth',
    options: {
      oscillator: { type: 'square' },
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
    },
    filter: { type: 'lowpass', frequency: 2400, Q: 3 },
    vibrato: { frequency: 5.6, depth: 0.12, wet: 0.4 },
    volume: -10,
  },
  {
    id: 'sub-bass',
    label: 'Sub Bass',
    icon: '🎸',
    family: 'bass',
    synth: 'MembraneSynth',
    options: {
      pitchDecay: 0.08,
      octaves: 3,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.6, sustain: 0.4, release: 0.4 },
    },
    filter: { type: 'lowpass', frequency: 420, Q: 0.9 },
    volume: -4,
  },
  {
    id: 'rubber-bass',
    label: 'Rubber Bass',
    icon: '🎸',
    family: 'bass',
    synth: 'FMSynth',
    options: {
      harmonicity: 0.5,
      modulationIndex: 8,
      oscillator: { type: 'triangle' },
      modulation: { type: 'square' },
      envelope: { attack: 0.008, decay: 0.32, sustain: 0.35, release: 0.25 },
      modulationEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.2, release: 0.2 },
    },
    filter: { type: 'lowpass', frequency: 700, Q: 4 },
    volume: -6,
  },
  {
    id: 'nylon-pluck',
    label: 'Nylon Pluck',
    icon: '🪕',
    family: 'pluck',
    synth: 'PluckSynth',
    options: {
      attackNoise: 1.2,
      dampening: 3800,
      resonance: 0.92,
      release: 0.9,
    },
    volume: -8,
  },
  {
    id: 'marimba',
    label: 'Marimba',
    icon: '🪵',
    family: 'pluck',
    synth: 'AMSynth',
    options: {
      harmonicity: 4,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.5, sustain: 0.02, release: 0.3 },
      modulation: { type: 'square' },
      modulationEnvelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.1 },
    },
    volume: -8,
  },
  {
    id: 'drum-kit',
    label: 'Drum Kit',
    icon: '🥁',
    family: 'kit',
    synth: 'kit',
    options: {},
    volume: 0,
  },
];

const BY_ID = new Map<string, PresetPatch>(PRESETS.map(preset => [preset.id, preset]));

/**
 * THE OLD SIX NAMES, ACCEPTED AND MAPPED, because a browser holding yesterday's bundle still sends them.
 *
 * The ids on the wire used to be synth CLASSES. A page open across the deploy sends 'PolySynth' on join,
 * and a schema that refuses it would lock that listener out of their own room. The alias is read at the
 * door and turned into a preset, so no client breaks and no room has to be told twice.
 */
export const LEGACY_INSTRUMENT_ALIASES: Record<string, PresetId> = {
  PolySynth: 'electric-piano',
  AMSynth: 'reed-piano',
  FMSynth: 'brass',
  DrumKit: 'drum-kit',
  PluckSynth: 'nylon-pluck',
  MembraneSynth: 'sub-bass',
};

/** A preset id from anything the wire might carry: today's id, yesterday's class name, or nothing. */
export function instrumentFromWire(id: string | undefined | null): PresetId | undefined {
  if (!id) return undefined;
  if (presetById(id)) return id as PresetId;
  return LEGACY_INSTRUMENT_ALIASES[id];
}

/** The patch for a player's instrument, or undefined for an id the room does not build. */
export function presetById(id: string): PresetPatch | undefined {
  return BY_ID.get(id);
}

/** Presets grouped the way the card's list shows them. */
export function presetsByFamily(): { family: PresetFamily; presets: PresetPatch[] }[] {
  const order: PresetFamily[] = ['keys', 'pad', 'lead', 'bass', 'pluck', 'kit'];
  return order
    .map(family => ({ family, presets: PRESETS.filter(preset => preset.family === family) }))
    .filter(group => group.presets.length > 0);
}

/** The instrument a seat is born with, when the spawn names none. */
export const SEAT_PRESETS = {
  lead: 'electric-piano',
  answer: 'reed-piano',
  ornament: 'nylon-pluck',
  drums: 'drum-kit',
  bass: 'sub-bass',
} as const satisfies Record<string, PresetId>;
