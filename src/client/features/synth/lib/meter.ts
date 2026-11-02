/**
 * A SPECTRUM BECOMES BARS, and this conversion is the only part of the meter a test can see.
 *
 * The engine's analyser answers decibels per frequency bin, from -100 (silence) up to 0 (full scale).
 * A bar is drawn from the LOUDEST bin in its group rather than the average, because an average over a
 * group where one bass note is ringing reads as quiet: the note is what a listener hears and what the
 * meter has to show. The top 80 dB is mapped across the bar, which is the range a room actually uses;
 * mapping the whole 100 dB leaves every bar under half height at a normal playing level.
 *
 * Kept separate from the component so it can be graded without a browser: a meter that cannot be
 * measured is how the room ended up with a note roll its own comment called a waveform.
 */
export function meterFromSpectrum(spectrum: ArrayLike<number>, bars: number): number[] {
  if (!(bars > 0)) return [];
  const out = new Array<number>(bars).fill(0);
  const bins = spectrum.length;
  if (bins === 0) return out;
  for (let bar = 0; bar < bars; bar++) {
    const from = Math.floor((bar * bins) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * bins) / bars));
    let peak = -Infinity;
    for (let i = from; i < to && i < bins; i++) {
      const value = spectrum[i];
      if (typeof value === 'number' && value > peak) peak = value;
    }
    if (!Number.isFinite(peak)) continue;
    out[bar] = Math.min(1, Math.max(0, (peak + 100) / 80));
  }
  return out;
}
