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
      element.dataset.channels = String(snapshot?.channels ?? 0);
      // HOW DIFFERENT THE CHANNELS ARE, in absolute terms. Correlation alone cannot tell "no pan" from
      // "pan applied but the band is centred", and this can.
      let delta = 0;
      const compare = Math.min(left.length, right.length);
      for (let i = 0; i < compare; i++) delta += Math.abs((left[i] ?? 0) - (right[i] ?? 0));
      element.dataset.delta = (compare ? delta / compare : 0).toFixed(4);
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
      // A TRACE IS A GLOW, not a line of single pixels: at 1.4 px and low alpha the pane read as almost
      // empty in the gate, which is the reading telling me a listener would see nothing either.
      context.globalCompositeOperation = 'lighter';
      trail.forEach((point, i) => {
        const fresh = i / Math.max(1, trail.length);
        const alpha = 0.08 + fresh * 0.5;
        context.fillStyle = `rgba(129,140,248,${alpha})`;
        context.beginPath();
        context.arc(point.x, point.y, 1.2 + fresh * 1.8, 0, Math.PI * 2);
        context.fill();
      });
      context.globalCompositeOperation = 'source-over';
      const lastPoint = trail[trail.length - 1];
      if (lastPoint) {
        context.fillStyle = '#e0e7ff';
        context.beginPath();
        context.arc(lastPoint.x, lastPoint.y, 2.4, 0, Math.PI * 2);
        context.fill();
      }

      // THE READOUT: correlation, width, and the two channel bars.
      context.fillStyle = correlation < -0.2 ? '#f472b6' : '#e0e7ff';
      context.font = '11px ui-sans-serif, system-ui, sans-serif';
      // PHASE AND WIDTH ARE TWO DIFFERENT READINGS. A mono source panned left has a WIDE image and a
      // correlation of 1.0, because panning changes level rather than content; only two different
      // sources on opposite sides lower the correlation. Reporting correlation alone as "mono" was
      // wrong about a panned room, and the delta is what tells the two apart.
      context.fillText(`phase ${correlation.toFixed(2)}`, 10, 18);
      context.fillStyle = '#8b8ba7';
      const deltaText = element.dataset.delta ?? '0.0000';
      context.fillText(`width ${(side * 100).toFixed(0)}  delta ${deltaText}  mid ${(mid * 100).toFixed(0)}`, 10, 34);

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
