import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { bandsFromSpectrum } from '../lib/analysis';

interface AtmosPaneProps {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

/**
 * ATMOSPHERE, with the restraint Endel is the reference for rather than the preset zoo Milkdrop became.
 *
 * The rule this follows: the picture may breathe with the room, it must never move faster than the
 * music. Bass pushes the glow radius, the mids drift the dust, the treble sets how many sparks are lit,
 * and every value is eased toward its target rather than snapped, so a kick reads as a swell and not as
 * a flicker. Nothing here is a spectrum: it is the room's energy, not its frequencies.
 */
export function AtmosPane({ engine, width = 800, height = 200 }: AtmosPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;
    const element: HTMLCanvasElement = canvas;

    const dust = Array.from({ length: 70 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      drift: 0.08 + Math.random() * 0.22,
      size: 0.7 + Math.random() * 1.8,
      phase: (i / 70) * Math.PI * 2,
    }));

    let eased = { bass: 0, mid: 0, treble: 0 };
    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      const dt = Math.min(80, now - last);
      last = now;

      const snapshot = engine?.analyserSnapshot() ?? null;
      const bands = snapshot ? bandsFromSpectrum(snapshot.spectrum) : { bass: 0, mid: 0, treble: 0 };
      // EASE, NEVER SNAP: 0.12 per frame at 30 fps is a swell of about a third of a second.
      eased = {
        bass: eased.bass + (bands.bass - eased.bass) * 0.12,
        mid: eased.mid + (bands.mid - eased.mid) * 0.09,
        treble: eased.treble + (bands.treble - eased.treble) * 0.16,
      };
      element.dataset.bass = eased.bass.toFixed(3);
      element.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      context.fillStyle = '#05050a';
      context.fillRect(0, 0, width, height);

      const cx = width * (0.5 + Math.sin(now / 9000) * 0.06 * (1 + eased.mid));
      const cy = height * 0.56;
      const radius = height * (0.28 + eased.bass * 0.75);
      const glow = context.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius);
      glow.addColorStop(0, `rgba(129,140,248,${0.16 + eased.bass * 0.38})`);
      glow.addColorStop(0.55, `rgba(79,70,229,${0.08 + eased.mid * 0.22})`);
      glow.addColorStop(1, 'rgba(5,5,10,0)');
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      for (const mote of dust) {
        // The dust drifts on the mids and wraps, so the picture never accumulates in one corner.
        mote.y -= mote.drift * (0.4 + eased.mid * 2.2) * (dt / 16);
        if (mote.y < -4) mote.y = height + 4;
        const x = mote.x + Math.sin(now / 4000 + mote.phase) * (2 + eased.mid * 10);
        const lit = eased.treble > 0.35;
        context.fillStyle = lit ? 'rgba(244,114,182,0.55)' : 'rgba(165,180,252,0.28)';
        context.beginPath();
        context.arc(x, mote.y, mote.size * (1 + eased.bass * 0.9), 0, Math.PI * 2);
        context.fill();
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="atmos-pane"
      width={width}
      height={height}
      aria-label="Atmosphere reacting to the room"
      data-bass="0.000"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
