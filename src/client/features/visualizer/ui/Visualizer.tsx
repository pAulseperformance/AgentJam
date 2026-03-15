import { useRef, useEffect } from 'react';
import type { NoteEvent } from '@/shared/protocol';

interface NoteRect {
  pitch: string;
  peerId: string;
  startTime: number;
  endTime: number | null; // null = still held
  velocity: number;
  color: string;
}

// MIDI pitch to Y position (C2 = bottom, C7 = top)
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function pitchToY(pitch: string, height: number): number {
  const match = pitch.match(/^([A-G]#?)(\d)$/);
  if (!match) return height / 2;
  const noteName = match[1] ?? 'C';
  const octave = parseInt(match[2] ?? '4', 10);
  const noteIndex = PITCH_NAMES.indexOf(noteName);
  const midiNote = (octave + 1) * 12 + noteIndex; // C2=36, C7=96
  const normalizedY = (midiNote - 36) / (96 - 36); // 0 to 1
  return height - normalizedY * height; // invert Y axis
}

interface VisualizerProps {
  width?: number;
  height?: number;
  /** External note buffer — if provided, reads from this instead of internal ref */
  notesRef?: React.RefObject<NoteRect[]>;
}

/**
 * Real-time waveform/note visualizer (TAS-63).
 *
 * v5 Pattern: Uses requestAnimationFrame loop reading from a mutable
 * useRef circular buffer — NEVER reads from React state. Note events
 * are pushed into the buffer by the WebSocket handler (imperative),
 * and the rAF loop reads them without triggering React re-renders.
 */
export function Visualizer({ width = 800, height = 300, notesRef: externalNotesRef }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const internalNotesRef = useRef<NoteRect[]>([]);
  const effectiveNotesRef = externalNotesRef ?? internalNotesRef;
  const animFrameRef = useRef<number | null>(null);

  // rAF render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const now = performance.now();
      const windowMs = 5000; // show last 5 seconds

      // Clear
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Draw grid lines
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const y = (i / 12) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw note rectangles
      const notes = effectiveNotesRef.current;
      for (const note of notes) {
        const endTime = note.endTime ?? now;

        // Skip notes outside visible window
        if (endTime < now - windowMs) continue;
        if (note.startTime > now) continue;

        const x1 = Math.max(0, ((note.startTime - (now - windowMs)) / windowMs) * width);
        const x2 = Math.min(width, ((endTime - (now - windowMs)) / windowMs) * width);
        const y = pitchToY(note.pitch, height);
        const noteHeight = height / 60; // ~5px per note

        ctx.fillStyle = note.color;
        ctx.globalAlpha = 0.7 + (note.velocity / 127) * 0.3;
        ctx.fillRect(x1, y - noteHeight / 2, Math.max(2, x2 - x1), noteHeight);
        ctx.globalAlpha = 1;
      }

      // Prune old notes (>10s old and ended)
      effectiveNotesRef.current = notes.filter((n) => {
        if (n.endTime === null) return true;
        return n.endTime > now - 10000;
      });

      // Playhead line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(width, 0);
      ctx.lineTo(width, height);
      ctx.stroke();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="visualizer"
      width={width}
      height={height}
      aria-label="Note visualizer"
    />
  );
}

/**
 * Push a note event into the visualizer's mutable buffer.
 * This is called OUTSIDE React — from the WebSocket handler directly.
 * Returns a ref-compatible push function for external use.
 */
export function createVisualizerPusher(
  notesRef: React.RefObject<NoteRect[]>,
  getPeerColor: (peerId: string) => string,
) {
  return (event: NoteEvent) => {
    const notes = notesRef.current;
    if (!notes) return;

    if (event.type === 'note_on') {
      notes.push({
        pitch: event.pitch,
        peerId: event.peerId,
        startTime: performance.now(),
        endTime: null,
        velocity: event.velocity,
        color: getPeerColor(event.peerId),
      });
    } else {
      // Find the matching active note and close it
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        if (note && note.pitch === event.pitch && note.peerId === event.peerId && note.endTime === null) {
          note.endTime = performance.now();
          break;
        }
      }
    }
  };
}
