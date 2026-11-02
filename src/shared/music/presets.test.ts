import { describe, expect, it } from 'vitest';
import { PRESETS, PRESET_IDS, SEAT_PRESETS, instrumentFromWire, presetById, presetsByFamily } from './presets';
import { INSTRUMENT_IDS, DEFAULT_INSTRUMENT } from './instruments';
import { STYLE_ROWS } from './styles';

/**
 * EVERY PLAYER COMES WITH AN INSTRUMENT, so the instrument table is the thing to pin: a preset that is
 * incomplete builds a silent voice, a style row naming a preset that does not exist leaves that band
 * silent, and a seat with no default is a bot that arrives with nothing attached.
 */
describe('the preset table', () => {
  it('carries every field a patch needs on every row', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const preset of PRESETS) {
      expect(PRESET_IDS, `${preset.id} is in the id list`).toContain(preset.id);
      expect(preset.label.length, `${preset.id} is named`).toBeGreaterThan(2);
      expect(preset.icon.length, `${preset.id} has an icon`).toBeGreaterThan(0);
      expect(preset.family.length, `${preset.id} has a family`).toBeGreaterThan(0);
      if (preset.synth === 'kit') continue; // the drum map is its own instrument, not a PolySynth patch
      // a pitched patch without an envelope is a click, and without an oscillator it is silence
      expect(preset.options, `${preset.id} carries synth options`).toBeTruthy();
      expect(Object.keys(preset.options).length, `${preset.id} names its oscillator`).toBeGreaterThan(0);
    }
  });

  it('has one entry per id, and the ids ARE the wire list', () => {
    expect(new Set(PRESET_IDS).size).toBe(PRESET_IDS.length);
    expect([...INSTRUMENT_IDS]).toEqual([...PRESET_IDS]);
    expect(PRESETS.length).toBe(PRESET_IDS.length);
  });

  it('groups the picker without losing a preset', () => {
    const grouped = presetsByFamily().flatMap(group => group.presets.map(preset => preset.id));
    expect(grouped.sort()).toEqual([...PRESET_IDS].sort());
  });

  it('every style row names a preset the room can build', () => {
    for (const row of STYLE_ROWS) {
      expect(presetById(row.instrument), `style ${row.id} names ${row.instrument}`).toBeTruthy();
    }
  });

  it('every seat is born with an instrument', () => {
    for (const [seat, id] of Object.entries(SEAT_PRESETS)) {
      expect(presetById(id), `${seat} is born with ${id}`).toBeTruthy();
    }
    expect(presetById(DEFAULT_INSTRUMENT)).toBeTruthy();
  });

  it('reads the six old class names off the wire, so a page loaded yesterday still joins', () => {
    expect(instrumentFromWire('PolySynth')).toBe('electric-piano');
    expect(instrumentFromWire('DrumKit')).toBe('drum-kit');
    expect(instrumentFromWire('MembraneSynth')).toBe('sub-bass');
    expect(instrumentFromWire('rubber-bass')).toBe('rubber-bass');
    expect(instrumentFromWire('nonsense')).toBeUndefined();
    expect(instrumentFromWire(undefined)).toBeUndefined();
  });
});
