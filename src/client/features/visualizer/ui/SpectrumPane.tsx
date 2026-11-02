import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { SPECTRUM_BARS, holdPeaks, spectrumToBars } from '../lib/analysis';

interface SpectrumPaneProps {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

/**
 * THE SPECTRUM PANE, in the shape the market settled on (audioMotion, Ableton's Spectrum, FabFilter):
 * a log frequency axis, a peak-hold marker that falls slowly, and a gradient that darkens at the floor
 * so the bars read as a shape rather than as a row of equal columns.
 *
 * This is the correction to the room's first meter: sixteen linear bars of a 64-bin FFT, no hold and no
 * decay, which is why it looked like a bar chart rather than an instrument.
 */
export function SpectrumPane({ engine, width = 800, height = 180 }: SpectrumPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;
    const element: HTMLCanvasElement = canvas;
    let frame = 0;
    let peaks: number[] = [];
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;

      const snapshot = engine?.analyserSnapshot() ?? null;
      const levels = snapshot ? spectrumToBars(snapshot.spectrum, SPECTRUM_BARS) : new Array<number>(SPECTRUM_BARS).fill(0);
      peaks = holdPeaks(levels, peaks, 0.015);
      const peak = levels.reduce((max, level) => Math.max(max, level), 0);
      element.dataset.peak = peak.toFixed(3);
      element.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      context.fillStyle = '#08080c';
      context.fillRect(0, 0, width, height);

      const slot = width / SPECTRUM_BARS;
      const barWidth = Math.max(2, slot * 0.72);
      for (let i = 0; i < SPECTRUM_BARS; i++) {
        const level = levels[i] ?? 0;
        const h = Math.max(1, level * (height - 8));
        const x = i * slot + (slot - barWidth) / 2;
        const gradient = context.createLinearGradient(0, height, 0, height - h);
        gradient.addColorStop(0, '#312e81');
        gradient.addColorStop(0.55, '#6366f1');
        gradient.addColorStop(1, level > 0.8 ? '#f472b6' : '#a5b4fc');
        context.fillStyle = gradient;
        context.fillRect(x, height - h - 2, barWidth, h);

        const peakY = height - Math.max(1, (peaks[i] ?? 0) * (height - 8)) - 2;
        context.fillStyle = '#e0e7ff';
        context.fillRect(x, Math.max(0, peakY - 1), barWidth, 1.5);
      }

      context.strokeStyle = '#1a1a2e';
      context.beginPath();
      context.moveTo(0, height - 0.5);
      context.lineTo(width, height - 0.5);
      context.stroke();
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="spectrum-pane"
      width={width}
      height={height}
      aria-label="Live spectrum of the room's output"
      data-peak="0.000"
      data-armed="no"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
