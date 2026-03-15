import { useCallback, useRef, useState } from 'react';
import { useRoomSocket, PeerList, TransportBar } from '@/client/features/room';
import { useSynthEngine, Keyboard } from '@/client/features/synth';
import { Visualizer } from '@/client/features/visualizer';
import type { NoteEvent } from '@/shared/protocol';

interface JamRoomProps {
  roomId: string;
  playerName: string;
}

/**
 * JamRoom — the main page that assembles all features.
 *
 * Wiring:
 * - useRoomSocket → WebSocket connection to DO
 * - useSynthEngine → AudioEngine (vanilla TS, not React state)
 * - Keyboard → local note input → AudioEngine + WebSocket broadcast
 * - onNoteEvent (from WS) → AudioEngine (bypass React) + Visualizer buffer
 * - Visualizer → rAF loop reading mutable ref buffer
 */
export function JamRoom({ roomId, playerName }: JamRoomProps) {
  const { engine, startAudio } = useSynthEngine();
  const [audioStarted, setAudioStarted] = useState(false);
  const visualizerNotesRef = useRef<Array<{
    pitch: string;
    peerId: string;
    startTime: number;
    endTime: number | null;
    velocity: number;
    color: string;
  }>>([]);

  // Handle incoming remote note events — bypass React entirely
  const handleRemoteNoteEvent = useCallback((event: NoteEvent) => {
    if (!engine) return;

    // Route to AudioEngine (v5: direct, no React state)
    if (event.type === 'note_on') {
      engine.playNote(event.pitch, event.velocity, true); // isRemote = true → playout delay
    } else {
      engine.releaseNote(event.pitch);
    }

    // Push to visualizer buffer (mutable ref, no re-render)
    const notes = visualizerNotesRef.current;
    if (event.type === 'note_on') {
      notes.push({
        pitch: event.pitch,
        peerId: event.peerId,
        startTime: performance.now(),
        endTime: null,
        velocity: event.velocity,
        color: '#6366f1', // will be overridden by visualizer's color map
      });
    } else {
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        if (note && note.pitch === event.pitch && note.peerId === event.peerId && note.endTime === null) {
          note.endTime = performance.now();
          break;
        }
      }
    }
  }, [engine]);

  const { status, roomState, peers, sendMessage, sendNoteEvent } = useRoomSocket({
    roomId,
    playerName,
    playerKind: 'human',
    onNoteEvent: handleRemoteNoteEvent,
  });

  // Handle local note events from Keyboard → broadcast to peers
  const handleLocalNoteEvent = useCallback((type: 'note_on' | 'note_off', pitch: string, velocity: number) => {
    const event: NoteEvent = {
      type,
      peerId: 'local', // server will assign real peerId
      pitch,
      beatTime: 0,
      velocity,
      timestamp: Date.now(),
    };
    sendNoteEvent(event);

    // Also push to visualizer for local notes
    const notes = visualizerNotesRef.current;
    if (type === 'note_on') {
      notes.push({
        pitch,
        peerId: 'local',
        startTime: performance.now(),
        endTime: null,
        velocity,
        color: '#10b981', // local peer color
      });
    } else {
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        if (note && note.pitch === pitch && note.peerId === 'local' && note.endTime === null) {
          note.endTime = performance.now();
          break;
        }
      }
    }
  }, [sendNoteEvent]);

  const handleBpmChange = useCallback((bpm: number) => {
    sendMessage(JSON.stringify({ type: 'bpm_change', bpm }));
  }, [sendMessage]);

  const handleKeyChange = useCallback((key: string) => {
    sendMessage(JSON.stringify({ type: 'key_change', key }));
  }, [sendMessage]);

  const handleStartAudio = useCallback(async () => {
    await startAudio();
    setAudioStarted(true);
  }, [startAudio]);

  return (
    <div className="jam-room">
      {!audioStarted && (
        <div className="jam-room__overlay">
          <button
            className="jam-room__start-btn"
            onClick={handleStartAudio}
            id="start-audio"
          >
            🎵 Click to Start Audio
          </button>
          <p className="jam-room__hint">Browser requires user gesture to enable audio</p>
        </div>
      )}

      <header className="jam-room__header">
        <h1 className="jam-room__title">AgentJam</h1>
        <span className="jam-room__room-id">Room: {roomId}</span>
      </header>

      <TransportBar
        roomState={roomState}
        status={status}
        onBpmChange={handleBpmChange}
        onKeyChange={handleKeyChange}
      />

      <div className="jam-room__main">
        <aside className="jam-room__sidebar">
          <h2 className="jam-room__section-title">Peers</h2>
          <PeerList peers={peers} />
        </aside>

        <div className="jam-room__content">
          <Visualizer width={800} height={250} />

          {engine && (
            <Keyboard
              engine={engine}
              peerId="local"
              onNoteEvent={handleLocalNoteEvent}
            />
          )}
        </div>
      </div>
    </div>
  );
}
