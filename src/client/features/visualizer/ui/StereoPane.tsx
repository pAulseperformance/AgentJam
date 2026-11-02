import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { correlationOf, goniometerPoint, stereoEnergy } from '../lib/stereo';

interface StereoPaneProps {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

/**
 * THE STEREO FIELD, drawn the way hardware has drawn it for fifty years: a goniometer, a correlation
 * readout, and the two channel levels beside it.
 *
 * The room did not have a stereo image until the peers were panned by seat, so this pane is the reason
 * that work exists: before it, a goniometer would have drawn a single vertical line forever, which is
 * a meter that cannot fail and therefore tells nobody anything.
 */
export function StereoPane({ engine, width = 800, height = 200 }: StereoPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;
    const element: HTMLCanvasElement = canvas;
    const trail: { x: number; y: number }[] = [];
    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;

      const snapshot = engine?.analyserSnapshot() ?? null;
      const left = snapshot?.left ?? new Float32Array(0);
      const right = snapshot?.right ?? new Float32Array(0);
      const correlation = correlationOf(left, right);
      const { mid, side } = stereoEnergy(left, right);
      element.dataset.correlation = correlation.toFixed(3);
      element.dataset.side = side.toFixed(3);
      element.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      context.fillStyle = '#08080c';
      context.fillRect(0, 0, width, height);

      const size = Math.min(width, height) - 24;
      const cx = size / 2 + 12;
      const cy = height / 2;
      const radius = size / 2;

      // THE GRATICULE: a circle, the vertical mono axis, and the diagonals where a hard-panned voice sits.
      context.strokeStyle = '#1a1a2e';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(cx, cy - radius);
      context.lineTo(cx, cy + radius);
      context.moveTo(cx - radius * 0.707, cy + radius * 0.707);
      context.lineTo(cx + radius * 0.707, cy - radius * 0.707);
      context.stroke();

      // THE TRACE: a Lissajous of the two channels, older points fading out.
      const n = Math.min(left.length, right.length);
      const stride = Math.max(1, Math.floor(n / 320));
      for (let i = 0; i < n; i += stride) {
        const point = goniometerPoint(left[i] ?? 0, right[i] ?? 0, radius);
        trail.push({ x: cx + point.x, y: cy + point.y });
      }
      while (trail.length > 900) trail.shift();
      trail.forEach((point, i) => {
        const alpha = 0.10 + (i / trail.length) * 0.6;
        context.fillStyle = `rgba(165,180,252,${alpha})`;
        context.fillRect(point.x, point.y, 1.4, 1.4);
      });

      // THE READOUT: correlation, width, and the two channel bars.
      context.fillStyle = correlation < -0.2 ? '#f472b6' : '#e0e7ff';
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      context.fillText(`correlation ${correlation.toFixed(2)}`, 10, 18);
      context.fillStyle = '#8b8ba7';
      context.fillText(`width ${(side * 100).toFixed(0)}  mid ${(mid * 100).toFixed(0)}`, 10, 34);

      const barsX = width - 90;
      const meter = (value: number, y: number, colour: string) => {
        context.fillStyle = '#0f0f17';
        context.fillRect(barsX, y, 78, 8);
        context.fillStyle = colour;
        context.fillRect(barsX, y, 78 * Math.min(1, value * 3), 8);
      };
      let peakL = 0;
      let peakR = 0;
      for (let i = 0; i < n; i++) {
        peakL = Math.max(peakL, Math.abs(left[i] ?? 0));
        peakR = Math.max(peakR, Math.abs(right[i] ?? 0));
      }
      meter(peakL, 14, '#818cf8');
      meter(peakR, 26, '#a5b4fc');
      context.fillStyle = '#8b8ba7';
      context.fillText('L', barsX - 12, 22);
      context.fillText('R', barsX - 12, 34);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="stereo-pane"
      width={width}
      height={height}
      aria-label="Stereo field of the room's output"
      data-correlation="0.000"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
