import { useCallback, useEffect, useRef } from 'react';
import type { AudioEngine } from '../lib/audio-engine';

// Musical note layout matching standard piano keyboard
const KEY_MAP: Record<string, string> = {
  // Lower octave (Z row)
  z: 'C3', x: 'D3', c: 'E3', v: 'F3',
  b: 'G3', n: 'A3', m: 'B3',
  // Upper octave (A row)
  a: 'C4', s: 'D4', d: 'E4', f: 'F4',
  g: 'G4', h: 'A4', j: 'B4',
  // Higher octave (Q row)
  q: 'C5', w: 'D5', e: 'E5', r: 'F5',
  t: 'G5', y: 'A5', u: 'B5',
  // Sharps/flats (number row)
  '2': 'C#4', '3': 'D#4', '5': 'F#4',
  '6': 'G#4', '7': 'A#4',
};

const WHITE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_KEYS = ['C#', 'D#', null, 'F#', 'G#', 'A#', null];

interface KeyboardProps {
  engine: AudioEngine;
  peerId: string;
  onNoteEvent?: (type: 'note_on' | 'note_off', pitch: string, velocity: number) => void;
}

/**
 * Virtual QWERTY-mapped piano keyboard (TAS-71).
 *
 * Maps computer keyboard to musical notes and provides a clickable
 * on-screen piano. Routes all note events through the AudioEngine
 * directly (not through React state) and notifies the parent via
 * callback for WebSocket broadcast.
 */
export function Keyboard({ engine, peerId, onNoteEvent }: KeyboardProps) {
  const pressedKeys = useRef<Set<string>>(new Set());
  const onNoteEventRef = useRef(onNoteEvent);
  onNoteEventRef.current = onNoteEvent;

  const handleNoteOn = useCallback((pitch: string) => {
    if (pressedKeys.current.has(pitch)) return; // debounce repeats
    pressedKeys.current.add(pitch);

    engine.playNote(pitch, 100, false); // local = no playout delay
    onNoteEventRef.current?.('note_on', pitch, 100);
  }, [engine]);

  const handleNoteOff = useCallback((pitch: string) => {
    if (!pressedKeys.current.has(pitch)) return;
    pressedKeys.current.delete(pitch);

    engine.releaseNote(pitch);
    onNoteEventRef.current?.('note_off', pitch, 0);
  }, [engine]);

  // QWERTY keyboard bindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const pitch = KEY_MAP[e.key.toLowerCase()];
      if (pitch) {
        e.preventDefault();
        handleNoteOn(pitch);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const pitch = KEY_MAP[e.key.toLowerCase()];
      if (pitch) {
        e.preventDefault();
        handleNoteOff(pitch);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [handleNoteOn, handleNoteOff]);

  // Suppress unused peerId warning — used in stable identity for note events
  void peerId;

  return (
    <div className="keyboard" role="group" aria-label="Piano keyboard">
      <div className="keyboard__octave">
        {[3, 4, 5].map((octave) => (
          <div key={octave} className="keyboard__octave-group">
            {WHITE_KEYS.map((note) => {
              const pitch = `${note}${octave}`;
              return (
                <button
                  key={pitch}
                  className="keyboard__key keyboard__key--white"
                  onPointerDown={() => handleNoteOn(pitch)}
                  onPointerUp={() => handleNoteOff(pitch)}
                  onPointerLeave={() => handleNoteOff(pitch)}
                  aria-label={pitch}
                >
                  <span className="keyboard__label">{pitch}</span>
                </button>
              );
            })}
            {BLACK_KEYS.map((note, i) => {
              if (!note) return <span key={`gap-${octave}-${String(i)}`} className="keyboard__gap" />;
              const pitch = `${note}${octave}`;
              return (
                <button
                  key={pitch}
                  className="keyboard__key keyboard__key--black"
                  onPointerDown={() => handleNoteOn(pitch)}
                  onPointerUp={() => handleNoteOff(pitch)}
                  onPointerLeave={() => handleNoteOff(pitch)}
                  aria-label={pitch}
                  style={{ left: `${(i + 0.5) * (100 / 7)}%` }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
