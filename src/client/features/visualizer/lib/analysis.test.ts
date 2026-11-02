import { describe, expect, it } from 'vitest';
import { bandsFromSpectrum, holdPeaks, pushSpectrogramColumn, spectrumToBars, wavePath } from './analysis';

/**
 * THE PANES' MATHS. Each case here is a defect a visualizer in the wild actually ships: a linear axis
 * that hides the bass, a peak marker with no hold, a scope that normalises itself so silence looks loud,
 * and a spectrogram that grows without bound.
 */
describe('the visualizer maths', () => {
  it('maps a log frequency axis, so the low end gets its own bars', () => {
    const spectrum = new Float32Array(128).fill(-90);
    spectrum[1] = -30;
    const bars = spectrumToBars(spectrum, 48);
    expect(bars[0]).toBeGreaterThan(0.7);
    // With 128 bins over 48 bars the lowest bins are shared by design, so the test is not that every
    // other bar is silent: it is that one loud bass bin lights the BOTTOM of the picture and not the
    // top, which is the difference between a log axis and a linear one.
    expect(bars.filter(level => level > 0).length).toBeLessThan(8);
    expect(bars.slice(-8).every(level => level === 0)).toBe(true);
  });

  it('is flat at silence and clamps at full scale', () => {
    expect(spectrumToBars(new Float32Array(128).fill(-90), 8)).toEqual(new Array(8).fill(0));
    expect(spectrumToBars(new Float32Array(128).fill(0), 8)).toEqual(new Array(8).fill(1));
  });

  it('holds a peak and lets it fall slowly', () => {
    expect(holdPeaks([0.9, 0.2], [], 0.05)).toEqual([0.9, 0.2]);
    // 0.2 falls by one step to 0.15, and the live level (0.1) is below it, so the hold wins.
    const held = holdPeaks([0.1, 0.1], [0.9, 0.2], 0.05);
    expect(held[0]).toBeCloseTo(0.85, 5);
    expect(held[1]).toBeCloseTo(0.15, 5);
    // A hold never goes below zero however long the room is quiet.
    expect(holdPeaks([0, 0], [0.01, 0], 0.05)).toEqual([0, 0]);
  });

  it('splits the output into three bands that follow the spectrum', () => {
    const spectrum = new Float32Array(90).fill(-90);
    spectrum[2] = -20;
    const bands = bandsFromSpectrum(spectrum);
    expect(bands.bass).toBeGreaterThan(0.9);
    expect(bands.mid).toBe(0);
    expect(bands.treble).toBe(0);
  });

  it('draws a scope unnormalised, so silence is a flat line', () => {
    const quiet = wavePath(new Float32Array([0.05, -0.05, 0]), 100, 40);
    const loud = wavePath(new Float32Array([1, -1, 0]), 100, 40);
    const spread = (points: { y: number }[]) => Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
    expect(spread(quiet)).toBeLessThan(spread(loud) / 10);
    expect(spread(quiet)).toBeGreaterThan(0);
  });

  it('keeps a spectrogram bounded, however long the room plays', () => {
    let columns: number[][] = [];
    for (let i = 0; i < 200; i++) columns = pushSpectrogramColumn(columns, [i, i], 10);
    expect(columns.length).toBe(10);
    expect(columns[9]).toEqual([199, 199]);
  });
});
