/**
 * THE PANES' MATHS, kept out of the components so it can be graded without a browser.
 *
 * Every visualizer in the wild is one of a handful of mappings, and each one is wrong in a way a test
 * can catch: a linear spectrum is two thirds empty because music's energy is low and dense; a spectrum
 * with no peak hold reads as noise; a scope normalised per frame makes silence look as loud as a chord;
 * a spectrogram that leaks one pixel per frame is a smear. These are the four mappings the room's
 * panes draw from.
 */

/** The default bar count for the spectrum pane: enough to see voicing, few enough to read. */
export const SPECTRUM_BARS = 48;

/**
 * A SPECTRUM IN BARS, ON A LOG FREQUENCY AXIS.
 *
 * Frequencies are grouped by equal RATIOS, not equal widths: an octave is the same width low and high,
 * which is what makes a bass line and a melody sit in the same picture. Each bar is the loudest bin in
 * its group, mapped from the useful 70 dB of decibels, and clamped at 1.
 */
export function spectrumToBars(spectrum: ArrayLike<number>, bars = SPECTRUM_BARS): number[] {
  if (!(bars > 0)) return [];
  const bins = spectrum.length;
  const out = new Array<number>(bars).fill(0);
  if (bins === 0) return out;
  // A 128-bin FFT over 24 kHz: bin i covers roughly i * (sampleRate / 2) / bins. Grouping by ratio means
  // the bar edges are geometric, from bin 1 to the last bin.
  //
  // THE EDGES ARE ONE RUNNING SEQUENCE, not two independent roundings per bar. Rounding each bar's floor
  // and ceiling separately collapses the low end, where consecutive geometric edges round to the same
  // bin: a test caught bin 1 landing in EVERY bar, so one loud bass note lit the whole picture. Each bar
  // now starts where the previous one ended, and the last bar ends at the last bin.
  const loBin = 1;
  const hiBin = bins - 1;
  const edges: number[] = [];
  for (let edge = 0; edge <= bars; edge++) {
    const ratio = Math.pow(hiBin / loBin, edge / bars);
    edges.push(Math.min(hiBin + 1, Math.max(loBin, Math.round(loBin * ratio))));
  }
  for (let bar = 0; bar < bars; bar++) {
    const from = edges[bar]!;
    const to = Math.max(from + 1, edges[bar + 1] ?? hiBin + 1);
    let peak = -Infinity;
    for (let i = from; i < Math.min(to, bins); i++) {
      const value = spectrum[i];
      if (typeof value === 'number' && value > peak) peak = value;
    }
    if (!Number.isFinite(peak)) continue;
    out[bar] = Math.min(1, Math.max(0, (peak + 90) / 70));
  }
  return out;
}

/**
 * PEAK HOLD WITH A SLOW FALL. A peak marker that jumped to the current level would be invisible on a
 * percussive room; the hold rises instantly and falls by `fall` per frame, which is the behaviour that
 * makes a meter readable while a drummer is playing.
 */
export function holdPeaks(levels: number[], previous: number[], fall = 0.02): number[] {
  return levels.map((level, i) => {
    const before = previous[i] ?? 0;
    return Math.max(level, Math.max(0, before - fall));
  });
}

/** Three coarse bands for the panes that react to energy rather than to frequency. */
export function bandsFromSpectrum(spectrum: ArrayLike<number>): { bass: number; mid: number; treble: number } {
  const bins = spectrum.length;
  if (bins === 0) return { bass: 0, mid: 0, treble: 0 };
  const group = (from: number, to: number): number => {
    let peak = -Infinity;
    for (let i = Math.max(0, from); i < Math.min(bins, to); i++) {
      const value = spectrum[i];
      if (typeof value === 'number' && value > peak) peak = value;
    }
    return Number.isFinite(peak) ? Math.min(1, Math.max(0, (peak + 90) / 70)) : 0;
  };
  const third = Math.max(1, Math.floor(bins / 3));
  return {
    bass: group(1, third),
    mid: group(third, third * 2),
    treble: group(third * 2, bins),
  };
}

/**
 * A WAVE AS POINTS ACROSS THE CANVAS.
 *
 * The samples are clamped to the canvas and NOT normalised to their own peak: a scope that rescales
 * every frame shows silence as a full-height wave, which is the one reading a scope exists to give.
 */
export function wavePath(wave: ArrayLike<number>, width: number, height: number): { x: number; y: number }[] {
  const n = wave.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const points: { x: number; y: number }[] = [];
  const step = Math.max(1, Math.floor(n / Math.max(1, width)));
  for (let i = 0; i < n; i += step) {
    const sample = Math.max(-1, Math.min(1, wave[i] ?? 0));
    points.push({ x: (i / (n - 1 || 1)) * width, y: height / 2 - sample * (height / 2) });
  }
  return points;
}

/**
 * A SPECTROGRAM COLUMN, pushed at the right edge so history scrolls left. Columns are kept as arrays of
 * the pane's own bar count, so the whole history is a ring of small arrays rather than an image.
 */
export function pushSpectrogramColumn(columns: number[][], next: number[], width: number): number[][] {
  if (!(width > 0)) return columns;
  const out = columns.concat([next.slice()]);
  return out.length > width ? out.slice(out.length - width) : out;
}
