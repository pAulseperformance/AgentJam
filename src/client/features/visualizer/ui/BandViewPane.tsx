import { useEffect, useRef } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { bandsFromSpectrum } from '../lib/analysis';

/** The note buffer the room already keeps for the roll: one entry per note, with the peer's colour. */
export interface BandNote {
  pitch: string;
  peerId: string;
  startTime: number;
  endTime: number | null;
  velocity: number;
  color: string;
}

interface BandViewPaneProps {
  engine: AudioEngine | null;
  notesRef: React.RefObject<BandNote[]>;
  /** peerId to display name, so a lane says who rather than a uuid prefix */
  names?: Map<string, string>;
  width?: number;
  height?: number;
  windowMs?: number;
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiOf(pitch: string): number {
  const match = pitch.match(/^([A-G]#?)(\d)$/);
  if (!match) return 60;
  const index = PITCH_NAMES.indexOf(match[1] ?? 'C');
  return (parseInt(match[2] ?? '4', 10) + 1) * 12 + Math.max(0, index);
}

/**
 * THE BAND VIEW: one lane per player, time running left to right.
 *
 * The note roll answers "which pitches are sounding"; this answers "who played that, and when", which is
 * the question a listener in a jam actually asks. It borrows the grammar the market settled on (falling
 * notes in Synthesia and SeeMusic: a note owns a shape whose extent is its duration) and turns it
 * sideways, because a lane per player is the axis this room has and a piano app does not.
 *
 * A bar the room filled itself is drawn as a pale marker in that peer's lane, so a listener can see when
 * the generator covered for a late call rather than hearing an unexplained bar.
 */
export function BandViewPane({ engine, notesRef, names, width = 800, height = 200, windowMs = 6000 }: BandViewPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;
    const element: HTMLCanvasElement = canvas;
    let frame = 0;
    let last = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / 30) return;
      last = now;

      const notes = notesRef.current ?? [];
      const snapshot = engine?.analyserSnapshot() ?? null;
      const bands = snapshot ? bandsFromSpectrum(snapshot.spectrum) : { bass: 0, mid: 0, treble: 0 };
      // INDEXED ONCE PER FRAME. Scanning the whole buffer per lane is peers times notes per frame, and
      // the buffer only recently started being pruned, so the cheap shape is the one to keep.
      const byPeer = new Map<string, BandNote[]>();
      for (const note of notes) {
        const lane = byPeer.get(note.peerId);
        if (lane) lane.push(note);
        else byPeer.set(note.peerId, [note]);
      }
      const peers = [...byPeer.keys()].slice(-6);
      const laneH = Math.max(10, Math.floor((height - 30) / Math.max(1, peers.length)));
      const t = performance.now();
      const from = t - windowMs;

      element.dataset.lanes = String(peers.length);
      element.dataset.notes = String(notes.filter(note => note.startTime >= from).length);
      element.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      context.fillStyle = '#08080c';
      context.fillRect(0, 0, width, height);

      // BAR LINES: one per second of the window, so the picture has a floor to stand on.
      context.strokeStyle = '#151526';
      context.lineWidth = 1;
      for (let x = 0; x <= width; x += width / 6) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height - 26);
        context.stroke();
      }

      peers.forEach((peerId, lane) => {
        const y = lane * laneH + 4;
        const label = names?.get(peerId) ?? peerId.slice(0, 4);
        context.fillStyle = '#8b8ba7';
        context.font = '10px ui-sans-serif, system-ui, sans-serif';
        context.fillText(label, 3, y + laneH - 3);

        for (const note of byPeer.get(peerId) ?? []) {
          const started = Math.max(note.startTime, from);
          const ended = Math.min(note.endTime ?? t, t);
          if (ended < from) continue;
          const x1 = ((started - from) / windowMs) * width;
          const x2 = Math.max(x1 + 2, ((ended - from) / windowMs) * width);
          const midi = midiOf(note.pitch);
          const heightInLane = Math.max(3, (note.velocity / 127) * (laneH - 2));
          const pitchOffset = ((midi - 36) / 60) * (laneH - heightInLane);
          context.fillStyle = note.color;
          context.globalAlpha = 0.9;
          context.fillRect(x1, y + laneH - heightInLane - pitchOffset + 2, x2 - x1, heightInLane);
          context.globalAlpha = 1;
        }
      });

      // THE ENERGY STRIP: three bands, one bar each, so the view still answers to the sound.
      const stripY = height - 20;
      const stripBands: [number, string][] = [[bands.bass, '#7c3aed'], [bands.mid, '#6366f1'], [bands.treble, '#f472b6']];
      stripBands.forEach(([level, colour], i) => {
        context.fillStyle = '#0f0f17';
        context.fillRect(i * (width / 3), stripY, width / 3 - 2, 16);
        context.fillStyle = colour;
        context.fillRect(i * (width / 3), stripY, (width / 3 - 2) * Math.min(1, level), 16);
      });
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, notesRef, names, width, height, windowMs]);

  return (
    <canvas
      ref={canvasRef}
      className="band-view-pane"
      width={width}
      height={height}
      aria-label="Who is playing what, lane per player"
      data-lanes="0"
      data-notes="0"
      style={{ display: 'block', width: '100%', maxWidth: width, height }}
    />
  );
}
