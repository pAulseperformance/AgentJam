import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '../lib/audio-engine';
import { KEY_MAP, blackKeySeams, describePitch, inKey, letterFor, whitePitches } from '../lib/keyboard-layout';

const OCTAVES = [3, 4, 5] as const;
/**
 * A PIANO IS NOT SEVEN BUTTONS AND SOME GAPS. The white keys are one continuous strip and the black keys
 * sit ASTRIDE THE SEAMS between them: C# on the C/D seam, D# on D/E, then F#, G#, A# with no black key
 * between E and F or B and C. The old layout put a spacer where each absent black key would be and then
 * floated the black keys over nothing, which read as a row of tiles rather than an instrument.
 */
const WHITE_PITCHES = whitePitches(OCTAVES);
const BLACK_KEYS_ON_SEAMS = blackKeySeams(OCTAVES);
/** How wide a black key is against the white key it straddles. A real one is about 60 percent. */
const BLACK_KEY_RATIO = 0.62;

interface KeyboardProps {
  engine: AudioEngine;
  peerId: string;
  onNoteEvent?: (type: 'note_on' | 'note_off', pitch: string, velocity: number) => void;
  /** The room's key, so the piano can show which notes belong to it and which are outside */
  musicalKey?: string;
}

/**
 * THE PIANO, WITH ITS HELPERS DRAWN ON IT.
 *
 * Three readings a person playing by eye could not get before, all from the same data: every key carries
 * the computer letter that plays it (A S D F on the home row), the notes that belong to the room's key are
 * lit while the ones outside it are dimmed, and the note you just played is named beside the keyboard with
 * whether it fits.
 */
export function Keyboard({ engine, peerId, onNoteEvent, musicalKey }: KeyboardProps) {
  const pressedKeys = useRef<Set<string>>(new Set());
  const onNoteEventRef = useRef(onNoteEvent);
  onNoteEventRef.current = onNoteEvent;
  // The audio path stays on the ref, because a note is not a render. These two mirror it for the drawing.
  const [held, setHeld] = useState<string[]>([]);
  const [lastPlayed, setLastPlayed] = useState<string | null>(null);

  const handleNoteOn = useCallback((pitch: string) => {
    if (pressedKeys.current.has(pitch)) return; // debounce repeats
    pressedKeys.current.add(pitch);
    setHeld([...pressedKeys.current]);
    setLastPlayed(pitch);

    engine.playNote(pitch, 100, false); // local = no playout delay
    onNoteEventRef.current?.('note_on', pitch, 100);
  }, [engine]);

  const handleNoteOff = useCallback((pitch: string) => {
    if (!pressedKeys.current.has(pitch)) return;
    pressedKeys.current.delete(pitch);
    setHeld([...pressedKeys.current]);

    engine.releaseNote(pitch);
    onNoteEventRef.current?.('note_off', pitch, 0);
  }, [engine]);

  // QWERTY keyboard bindings — skip when user is typing in inputs
  useEffect(() => {
    const isTyping = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tag = active.tagName;
      // SELECT is NOT typing: the transport keeps a select focused after a mouse pick, and counting it
      // here swallowed every letter key. Editable regions are typing, and so are text inputs.
      return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable === true;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // A WAY BACK OUT. The guard above is right (a person typing their name is not playing), but it
      // also means a focused text field silences the piano, which reads as a broken keyboard. Escape
      // always hands the keys back, so nobody has to work out which field has focus.
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (e.repeat || isTyping()) return;
      const pitch = KEY_MAP[e.key.toLowerCase()];
      if (pitch) {
        e.preventDefault();
        handleNoteOn(pitch);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isTyping()) return;
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

  const renderKey = (pitch: string, black: boolean, geometry?: { left: string; width: string }) => {
    const letter = letterFor(pitch);
    const fits = inKey(pitch, musicalKey);
    const down = held.includes(pitch);
    return (
      <button
        key={pitch}
        className={[
          'keyboard__key',
          black ? 'keyboard__key--black' : 'keyboard__key--white',
          fits ? 'keyboard__key--in-key' : 'keyboard__key--outside',
          down ? 'keyboard__key--down' : '',
        ].join(' ')}
        onPointerDown={() => handleNoteOn(pitch)}
        onPointerUp={() => handleNoteOff(pitch)}
        onPointerLeave={() => handleNoteOff(pitch)}
        aria-label={`${pitch}${letter ? `, press ${letter}` : ''}${fits ? ', in key' : ', outside the key'}`}
        data-pitch={pitch}
        data-letter={letter}
        data-in-key={fits ? 'yes' : 'no'}
        style={black
          ? {
            left: geometry?.left,
            width: geometry?.width,
            // Centred on the seam it straddles, the way a black key actually sits.
            transform: 'translateX(-50%)',
            opacity: fits ? 1 : 0.55,
          }
          : { opacity: fits ? 1 : 0.62 }}
      >
        <span className="keyboard__label">{pitch}</span>
        {letter && <span className="keyboard__letter">{letter}</span>}
      </button>
    );
  };

  return (
    <div className="keyboard-wrap">
      <div className="keyboard__readout" data-last-note={lastPlayed ?? ''}>
        <span className="keyboard__readout-key">Key: {musicalKey ?? 'unset'}</span>
        <span className="keyboard__readout-note">
          {lastPlayed ? describePitch(lastPlayed, musicalKey) : 'the letters on the keys are the ones you press'}
        </span>
        <span className="keyboard__readout-held">{held.length ? `held ${held.join(' ')}` : ''}</span>
      </div>
      <div className="keyboard" role="group" aria-label="Piano keyboard">
        {/* ONE STRIP OF WHITE KEYS, with the black keys laid over the seams between them. The board is
            three octaves wide, so every percentage below is a fraction of 21 white keys. */}
        <div className="keyboard__keys">
          {WHITE_PITCHES.map(pitch => renderKey(pitch, false))}
          {BLACK_KEYS_ON_SEAMS.map(({ pitch, seam }) => renderKey(pitch, true, {
            left: `${(seam / WHITE_PITCHES.length) * 100}%`,
            width: `${(100 / WHITE_PITCHES.length) * BLACK_KEY_RATIO}%`,
          }))}
        </div>
      </div>
    </div>
  );
}
