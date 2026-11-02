import { describe, expect, it } from 'vitest';
import { correlationOf, goniometerPoint, panForIndex, stereoEnergy } from './stereo';

/**
 * THE STEREO FIELD. Two properties matter musically and one matters for the pane: the band spreads
 * without clustering, the measurement is honest about phase, and silence reads as zero rather than NaN.
 */
describe('the stereo field', () => {
  it('puts the first voice in the middle and alternates after it', () => {
    expect(panForIndex(0, 1)).toBe(0);
    expect(panForIndex(0, 4)).toBe(0);
    expect(panForIndex(1, 4)).toBeLessThan(0);
    expect(panForIndex(2, 4)).toBeGreaterThan(0);
    // Each successive pair sits closer to the centre, so six players are a spread rather than a crowd.
    expect(Math.abs(panForIndex(1, 6))).toBeGreaterThan(Math.abs(panForIndex(5, 6)));
    for (let i = 0; i < 8; i++) {
      const pan = panForIndex(i, 8);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    }
  });

  it('reads correlation: identical channels are one, inverted channels are minus one, silence is zero', () => {
    const left = new Float32Array([0.2, -0.4, 0.6, 0.1]);
    const inverted = new Float32Array([-0.2, 0.4, -0.6, -0.1]);
    expect(correlationOf(left, left)).toBeCloseTo(1, 5);
    expect(correlationOf(left, inverted)).toBeCloseTo(-1, 5);
    expect(correlationOf(new Float32Array(0), new Float32Array(0))).toBe(0);
    expect(correlationOf(new Float32Array(4), new Float32Array(4))).toBe(0);
  });

  it('measures width as side energy against mid', () => {
    const mono = new Float32Array([0.3, 0.3, 0.3]);
    const wide = new Float32Array([0.3, 0.3, 0.3]);
    const otherSide = new Float32Array([-0.3, -0.3, -0.3]);
    expect(stereoEnergy(mono, mono).side).toBeCloseTo(0, 6);
    expect(stereoEnergy(wide, otherSide).side).toBeGreaterThan(0.29);
  });

  it('plots a goniometer point on the mono axis for a centred voice', () => {
    const centre = goniometerPoint(0.5, 0.5, 100);
    expect(centre.x).toBeCloseTo(0, 6);
    expect(centre.y).toBeCloseTo(-70.7, 1);
    const hardLeft = goniometerPoint(0.5, 0, 100);
    expect(hardLeft.x).toBeLessThan(0);
  });
});
