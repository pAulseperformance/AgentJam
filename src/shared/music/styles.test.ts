import { describe, expect, it } from 'vitest';
import { STYLE_IDS, STYLE_ROWS, rowForBar, styleRow } from './styles';

/**
 * THE REGISTRY IS THE ONLY PLACE A STYLE IS DEFINED, so the tests here are about completeness and
 * fallback rather than about any one style's music: a row that is missing a number is a row whose
 * consumer invents one.
 */
describe('the style registry', () => {
  it('every row carries every field a consumer reads', () => {
    for (const row of STYLE_ROWS) {
      expect(row.label.length, `${row.id} label`).toBeGreaterThan(0);
      expect(row.verbs.length, `${row.id} verbs`).toBeGreaterThan(12);
      expect(row.drums.length, `${row.id} kit`).toBeGreaterThan(0);
      expect(row.bass.length, `${row.id} bass`).toBeGreaterThan(0);
      expect(row.notes.cadence, `${row.id} cadence`).toBeLessThanOrEqual(row.notes.fewest);
      expect(row.notes.fewest, `${row.id} fewest`).toBeLessThanOrEqual(row.notes.state);
      expect(row.notes.develop, `${row.id} develop`).toBeGreaterThanOrEqual(row.notes.state);
      expect(row.velocity.min, `${row.id} velocity band`).toBeLessThan(row.velocity.max);
      expect(row.tempo.min, `${row.id} tempo band`).toBeLessThan(row.tempo.max);
      expect(row.cell.notesPerCell, `${row.id} cell`).toBeGreaterThan(0);
      expect(row.cell.duration, `${row.id} cell duration`).toBeGreaterThan(0);
    }
  });

  it('lists each style once, in one order', () => {
    expect(new Set(STYLE_IDS).size).toBe(STYLE_IDS.length);
    expect(STYLE_IDS).toEqual(STYLE_ROWS.map(row => row.id));
  });

  it('answers jazz for an unknown or absent style, so an older room still plays', () => {
    expect(styleRow('afrobeat').id).toBe('jazz');
    expect(styleRow(undefined).id).toBe('jazz');
    expect(styleRow('funk').id).toBe('funk');
  });

  it('rotates a row that has no shape of its own, one bar at a time', () => {
    const bars = [0, 1, 2, 3].map(bar => rowForBar('random', bar).id);
    expect(bars).toEqual(['jazz', 'funk', 'ambient', 'jazz']);
    // A style with its own shape is the same row on every bar.
    expect([0, 1, 2].map(bar => rowForBar('funk', bar).id)).toEqual(['funk', 'funk', 'funk']);
  });
});
