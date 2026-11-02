/**
 * THE STEREO FIELD, which the room did not have: every voice was summed to a single point.
 *
 * Two decisions live here. A peer's POSITION in the field is assigned by its seat at the table, so the
 * band spreads without anyone touching a knob and the same listener hears the same layout twice. And the
 * field is measured honestly: a correlation of +1 is mono, 0 is wide, -1 is out of phase, and a room that
 * reports -1 has a phase problem rather than a wide image.
 */

/**
 * WHERE THE N-TH VOICE SITS, from -1 (hard left) to +1 (hard right).
 *
 * The first voice takes the centre, because in a jam the first person in is the one you are playing
 * with. After that the sides alternate, narrowing as the band fills, so two players are hard-ish left
 * and right and six players are a spread rather than a crowd: 
 *   0, -0.7, +0.7, -0.45, +0.45, -0.25, +0.25
 */
export function panForIndex(index: number, total: number): number {
  if (total <= 1 || index <= 0) return 0;
  const side = index % 2 === 1 ? -1 : 1;
  const rank = Math.ceil(index / 2);
  const widest = 0.7;
  const narrowest = 0.2;
  const span = Math.max(0, Math.ceil((Math.max(2, total) - 1) / 2));
  const step = span > 1 ? (widest - narrowest) / (span - 1) : 0;
  return Number((side * Math.max(narrowest, widest - (rank - 1) * step)).toFixed(3));
}

/**
 * HOW RELATED THE TWO CHANNELS ARE, from -1 to +1. Silence answers 0 rather than NaN, because a
 * goniometer that divides by nothing draws a dot at the origin and a reading of NaN looks like a bug.
 */
export function correlationOf(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const n = Math.min(left.length, right.length);
  if (n === 0) return 0;
  let sumLR = 0;
  let sumLL = 0;
  let sumRR = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    sumLR += l * r;
    sumLL += l * l;
    sumRR += r * r;
  }
  const denominator = Math.sqrt(sumLL * sumRR);
  if (!(denominator > 1e-9)) return 0;
  return Math.max(-1, Math.min(1, sumLR / denominator));
}

/** The side and mid energy of a stereo pair, which is what a width meter shows. */
export function stereoEnergy(left: ArrayLike<number>, right: ArrayLike<number>): { mid: number; side: number } {
  const n = Math.min(left.length, right.length);
  if (n === 0) return { mid: 0, side: 0 };
  let mid = 0;
  let side = 0;
  for (let i = 0; i < n; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
  }
  return { mid: Math.sqrt(mid / n), side: Math.sqrt(side / n) };
}

/**
 * A GONIOMETER POINT, rotated 45 degrees the way every hardware unit draws it: mono energy runs up the
 * middle, and a wide image opens sideways.
 */
export function goniometerPoint(left: number, right: number, scale = 100): { x: number; y: number } {
  const l = Math.max(-1, Math.min(1, left));
  const r = Math.max(-1, Math.min(1, right));
  // LEFT IS NEGATIVE X, the way a hardware unit draws it: a left-only voice sits at ten o'clock. The
  // sign is easy to get backwards and a test pins it, because a goniometer mirrored left for right is
  // worse than no goniometer at all.
  return { x: ((r - l) / Math.SQRT2) * scale, y: (-(l + r) / Math.SQRT2) * scale };
}
