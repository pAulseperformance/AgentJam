import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';

interface AudioMeterProps {
  /** The engine whose master output is being measured. Null before the audio overlay is answered. */
  engine: AudioEngine | null;
  bars?: number;
  width?: number;
  height?: number;
}

/**
 * THE AUDIO VISUALIZER: what the room SOUNDS like, drawn from the engine's own analyser.
 *
 * The note roll beside it draws rectangles from the note event stream, which is a score: it shows what
 * was scheduled, whether or not a speaker made a sound. This draws the master output, so silence, a
 * muted peer and a bar the room filled itself all look different here, and a note the engine dropped
 * leaves the meter flat while the roll still shows it.
 *
 * Thirty frames a second, not sixty, because this loop shares a thread with the scheduler that places
 * note onsets, and onset accuracy is the one property the room has already lost once.
 *
 * `data-peak` carries the loudest bar of the frame, so a reading can be taken from outside the page;
 * a meter nothing can measure is how the room shipped a note roll its own comment called a waveform.
 */
export function AudioMeter({ engine, bars = 16, width = 800, height = 56 }: AudioMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const context: CanvasRenderingContext2D = ctx;

    const frameMs = 1000 / 30;
    let last = 0;

    const draw = (now: number) => {
      frameRef.current = requestAnimationFrame(draw);
      if (now - last < frameMs) return;
      last = now;

      const levels = engine ? engine.meterLevels(bars) : new Array<number>(bars).fill(0);
      const peak = levels.reduce((max, level) => Math.max(max, level), 0);
      canvasEl.dataset.peak = peak.toFixed(3);
      canvasEl.dataset.armed = engine ? 'yes' : 'no';

      context.fillStyle = '#0a0a0f';
      context.fillRect(0, 0, width, height);

      const slot = width / bars;
      const barWidth = Math.max(2, slot * 0.6);
      for (let i = 0; i < bars; i++) {
        const level = levels[i] ?? 0;
        const h = Math.max(1, level * (height - 6));
        const x = i * slot + (slot - barWidth) / 2;
        // The top sixth of the meter is the loud end: a bar that reaches it is a bar a listener feels.
        context.fillStyle = level > 0.83 ? '#f472b6' : level > 0.5 ? '#818cf8' : '#4c1d95';
        context.fillRect(x, height - h - 2, barWidth, h);
      }

      context.strokeStyle = '#1a1a2e';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height - 0.5);
      context.lineTo(width, height - 0.5);
      context.stroke();
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [engine, bars, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="audio-meter"
      width={width}
      height={height}
      aria-label="Live audio level of the room's output"
      data-peak="0.000"
      data-armed="no"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
