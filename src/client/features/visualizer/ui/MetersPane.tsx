import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { SPECTRUM_BARS, bandsFromSpectrum, pushSpectrogramColumn, spectrumToBars, wavePath } from '../lib/analysis';

interface MetersPaneProps {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

/**
 * THE METER STRIP, in the shape a pro metering app settled on (MiniMeters): one scope, one spectrogram,
 * one loudness readout, each a small pane sharing a clock, instead of one picture that means everything.
 *
 * The spectrogram is the pane the others are built on: it is the only one that can show a bar the model
 * wrote against a bar the room filled, because the two look different as a shape over time.
 */
export function MetersPane({ engine, width = 800, height = 210 }: MetersPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;
    const element: HTMLCanvasElement = canvas;

    const scopeH = Math.round(height * 0.34);
    const specH = Math.round(height * 0.46);
    const barsH = height - scopeH - specH - 12;
    const columns = Math.max(60, Math.round(width / 4));
    let history: number[][] = [];
    let heldPeak = 0;
    let heldRms = 0;
    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;

      const snapshot = engine?.analyserSnapshot() ?? null;
      const levels = snapshot ? spectrumToBars(snapshot.spectrum, SPECTRUM_BARS) : new Array<number>(SPECTRUM_BARS).fill(0);
      const bands = snapshot ? bandsFromSpectrum(snapshot.spectrum) : { bass: 0, mid: 0, treble: 0 };

      // PEAK AND RMS, held with a slow fall. RMS is the honest loudness of a bar; peak is what clips.
      let sumSquares = 0;
      const wave = snapshot?.wave ?? new Float32Array(0);
      for (let i = 0; i < wave.length; i++) sumSquares += (wave[i] ?? 0) ** 2;
      const rms = wave.length ? Math.sqrt(sumSquares / wave.length) : 0;
      const peak = Math.max(bands.bass, bands.mid, bands.treble);
      heldPeak = Math.max(peak, Math.max(0, heldPeak - 0.02));
      heldRms = Math.max(rms, Math.max(0, heldRms - 0.01));
      element.dataset.peak = peak.toFixed(3);
      element.dataset.rms = rms.toFixed(3);
      element.dataset.bands = `${bands.bass.toFixed(2)},${bands.mid.toFixed(2)},${bands.treble.toFixed(2)}`;
      element.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      context.fillStyle = '#08080c';
      context.fillRect(0, 0, width, height);

      // 1. THE SCOPE. Unnormalised on purpose: silence must read as a flat line.
      context.strokeStyle = '#1a1a2e';
      context.beginPath();
      context.moveTo(0, scopeH / 2);
      context.lineTo(width, scopeH / 2);
      context.stroke();
      const points = wavePath(wave, width, scopeH - 6);
      if (points.length > 1) {
        context.strokeStyle = '#a5b4fc';
        context.lineWidth = 1.4;
        context.beginPath();
        points.forEach((point, i) => {
          const y = point.y + 3;
          if (i === 0) context.moveTo(point.x, y);
          else context.lineTo(point.x, y);
        });
        context.stroke();
      }

      // 2. THE SPECTROGRAM, scrolled: history is a ring of small columns, drawn one pixel wide.
      history = pushSpectrogramColumn(history, levels, columns);
      const cellW = width / columns;
      const cellH = specH / SPECTRUM_BARS;
      for (let c = 0; c < history.length; c++) {
        const column = history[c]!;
        for (let b = 0; b < SPECTRUM_BARS; b++) {
          const level = column[b] ?? 0;
          if (level <= 0.02) continue;
          // Low frequencies at the bottom, like every spectrogram a person has read before.
          const y = scopeH + 6 + (SPECTRUM_BARS - 1 - b) * cellH;
          const alpha = Math.min(1, level * 1.4);
          context.fillStyle = level > 0.8 ? `rgba(244,114,182,${alpha})` : `rgba(99,102,241,${alpha * 0.85})`;
          context.fillRect(c * cellW, y, Math.max(1, cellW), Math.max(1, cellH));
        }
      }

      // 3. PEAK AND RMS BARS, with the same hold the peak marker uses.
      const barTop = height - barsH - 2;
      context.fillStyle = '#0f0f17';
      context.fillRect(0, barTop, width, barsH + 2);
      context.fillStyle = '#4c1d95';
      context.fillRect(0, barTop, width * heldRms, barsH);
      context.fillStyle = heldPeak > 0.9 ? '#f472b6' : '#818cf8';
      context.fillRect(0, barTop, width * Math.max(0.004, heldPeak), 3);

      context.fillStyle = '#e0e7ff';
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      context.fillText(`peak ${(peak * 100).toFixed(0)}  rms ${(rms * 100).toFixed(0)}  bass ${(bands.bass * 100).toFixed(0)}  mid ${(bands.mid * 100).toFixed(0)}  high ${(bands.treble * 100).toFixed(0)}`, 6, barTop - 4);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="meters-pane"
      width={width}
      height={height}
      aria-label="Scope, spectrogram and loudness of the room's output"
      data-peak="0.000"
      data-rms="0.000"
      data-armed="no"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
