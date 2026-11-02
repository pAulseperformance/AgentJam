import { describe, expect, it } from 'vitest';
import { meterFromSpectrum } from './meter';

/**
 * THE METER READS THE AUDIO. What can be graded here is the mapping from decibels to bar heights,
 * and the three properties that make a meter honest: silence is flat, a loud bin lights its own bar,
 * and a group is judged by its loudest bin rather than its average.
 */
describe('meterFromSpectrum', () => {
  it('is flat at silence', () => {
    expect(meterFromSpectrum(new Float32Array(64).fill(-100), 8)).toEqual(new Array(8).fill(0));
  });

  it('lights the bar that owns a loud bin, and only that bar', () => {
    const spectrum = new Float32Array(64).fill(-100);
    spectrum[9] = -20;
    const bars = meterFromSpectrum(spectrum, 8);
    expect(bars[1]).toBe(1);
    expect(bars.filter((_, i) => i !== 1).every(h => h === 0)).toBe(true);
  });

  it('takes the loudest bin in a group, not the average', () => {
    // 8 bins over 2 bars: the first group is seven quiet bins and one at -20 dB. An average would read
    // about 0.11, and a meter that shows a ringing note at a tenth of its height is a meter that lies.
    const spectrum = new Float32Array([-100, -100, -100, -100, -100, -100, -100, -20, -100, -100, -100, -100, -100, -100, -100, -100]);
    const bars = meterFromSpectrum(spectrum, 2);
    expect(bars[0]).toBeGreaterThan(0.9);
    expect(bars[1]).toBe(0);
  });

  it('answers an empty bar list for a nonsense bar count', () => {
    expect(meterFromSpectrum(new Float32Array(8).fill(-40), 0)).toEqual([]);
    expect(meterFromSpectrum(new Float32Array(0), 4)).toEqual([0, 0, 0, 0]);
  });
});
