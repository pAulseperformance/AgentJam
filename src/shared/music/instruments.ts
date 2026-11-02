/**
 * THE PLAYER'S INSTRUMENT IS A PRESET PATCH, named once.
 *
 * This module used to hold six synth CLASSES (PolySynth, AMSynth, FMSynth, DrumKit, PluckSynth,
 * MembraneSynth), which is the engine's vocabulary and not a player's: two bots on "PolySynth" were the
 * same instrument as far as anyone could tell. The list now comes from the preset table, where a patch
 * carries its oscillator stack, envelope, filter and movement, so an instrument is something a listener
 * can name and a card can show.
 *
 * Shared code cannot import from the client, so the list lives here and both the server's validation and
 * the browser's audio engine derive from it: an id the engine cannot build is refused at spawn.
 */
import { PRESET_IDS, type PresetId } from './presets';

export const INSTRUMENT_IDS = PRESET_IDS;

export type InstrumentId = PresetId;

/** The instrument a player gets when neither the spawn nor the seat names one. */
export const DEFAULT_INSTRUMENT: InstrumentId = 'electric-piano';
