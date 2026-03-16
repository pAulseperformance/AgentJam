import { useCallback, useRef, useState, useMemo } from 'react';
import { useRoomSocket, PeerList, TransportBar, AgentPanel, MetricsPanel, AiDebugPanel } from '@/client/features/room';
import { useSynthEngine, Keyboard, useMidi, type InstrumentType } from '@/client/features/synth';
import { Visualizer } from '@/client/features/visualizer';
import type { NoteEvent, Peer } from '@/shared/protocol';

interface JamRoomProps {
  roomId: string;
  playerName: string;
}

/**
 * JamRoom — the main page that assembles all features.
 *
 * Phase 3 additions:
 * - AgentPanel for spawning/despawning AI agents (TAS-104)
 * - MetricsPanel for live performance stats (TAS-106)
 * - Event backfill handled by useRoomSocket (TAS-105)
 */
export function JamRoom({ roomId, playerName }: JamRoomProps) {
  const { engine, startAudio } = useSynthEngine();
  const [audioStarted, setAudioStarted] = useState(false);
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>('PolySynth');
  const [isRecording, setIsRecording] = useState(false);

  // MIDI controller support (TAS-116)
  const { connected: midiConnected, devices: midiDevices } = useMidi({
    onNoteOn: (pitch, velocity) => handleLocalNoteEvent('note_on', pitch, velocity),
    onNoteOff: (pitch) => handleLocalNoteEvent('note_off', pitch, 0),
    enabled: audioStarted,
  });
  const visualizerNotesRef = useRef<Array<{
    pitch: string;
    peerId: string;
    startTime: number;
    endTime: number | null;
    velocity: number;
    color: string;
  }>>([]);

  // Build a peerId → color lookup from the latest peer list
  const peerColorMapRef = useRef<Map<string, string>>(new Map());

  const updateColorMap = useCallback((peers: Peer[]) => {
    const map = peerColorMapRef.current;
    map.clear();
    for (const peer of peers) {
      map.set(peer.peerId, peer.color);
    }
  }, []);

  // Handle incoming remote note events — bypass React entirely
  const handleRemoteNoteEvent = useCallback((event: NoteEvent) => {
    if (!engine) return;

    // Route to AudioEngine with peerId for per-peer volume
    if (event.type === 'note_on') {
      engine.playNote(event.pitch, event.velocity, true, event.peerId);
    } else {
      engine.releaseNote(event.pitch, event.peerId);
    }

    // Push to visualizer buffer with peer-specific color
    const notes = visualizerNotesRef.current;
    const peerColor = peerColorMapRef.current.get(event.peerId) ?? '#6366f1';

    if (event.type === 'note_on') {
      notes.push({
        pitch: event.pitch,
        peerId: event.peerId,
        startTime: performance.now(),
        endTime: null,
        velocity: event.velocity,
        color: peerColor,
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

  const {
    status,
    roomState,
    peers,
    sendMessage,
    sendNoteEvent,
    metrics,
    wsRtt,
    clockOffset,
    aiDebugEntries,
  } = useRoomSocket({
    roomId,
    playerName,
    playerKind: 'human',
    onNoteEvent: handleRemoteNoteEvent,
  });

  const handleModelChange = useCallback((agentPeerId: string, model: string) => {
    sendMessage(JSON.stringify({ type: 'set_agent_model', agentPeerId, model }));
  }, [sendMessage]);

  // Keep color map in sync with peer list
  useMemo(() => updateColorMap(peers), [peers, updateColorMap]);

  // Derive local peerId — the peer whose name matches ours
  const localPeerId = useMemo(() => {
    const me = peers.find(p => p.name === playerName && p.kind === 'human');
    return me?.peerId;
  }, [peers, playerName]);

  // Local peer's assigned color
  const localColor = useMemo(() =>
    localPeerId ? peerColorMapRef.current.get(localPeerId) : undefined
  , [localPeerId, peers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle local note events from Keyboard → broadcast to peers
  const handleLocalNoteEvent = useCallback((type: 'note_on' | 'note_off', pitch: string, velocity: number) => {
    const event: NoteEvent = {
      type,
      peerId: 'local',
      pitch,
      beatTime: 0,
      velocity,
      timestamp: Date.now(),
    };
    sendNoteEvent(event);

    // Also push to visualizer for local notes with own color
    const notes = visualizerNotesRef.current;
    if (type === 'note_on') {
      notes.push({
        pitch,
        peerId: 'local',
        startTime: performance.now(),
        endTime: null,
        velocity,
        color: localColor ?? '#10b981',
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
  }, [sendNoteEvent, localColor]);

  const handleBpmChange = useCallback((bpm: number) => {
    sendMessage(JSON.stringify({ type: 'bpm_change', bpm }));
  }, [sendMessage]);

  const handleKeyChange = useCallback((key: string) => {
    sendMessage(JSON.stringify({ type: 'key_change', key }));
  }, [sendMessage]);

  const handleInstrumentChange = useCallback((instrument: InstrumentType) => {
    setCurrentInstrument(instrument);
    engine?.changeInstrument(instrument);
    sendMessage(JSON.stringify({ type: 'instrument_change', instrument }));
  }, [sendMessage, engine]);

  const handleToggleRecording = useCallback(() => {
    const newState = !isRecording;
    setIsRecording(newState);
    sendMessage(JSON.stringify({ type: newState ? 'recording_start' : 'recording_stop' }));
  }, [isRecording, sendMessage]);

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
        onInstrumentChange={handleInstrumentChange}
        currentInstrument={currentInstrument}
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
      />

      <div className="jam-room__main">
        <aside className="jam-room__sidebar">
          <h2 className="jam-room__section-title">Peers</h2>
          <PeerList
            peers={peers}
            engine={engine}
            localPeerId={localPeerId}
          />

          <AgentPanel
            sendMessage={sendMessage}
            peers={peers}
          />

          {/* MIDI status (TAS-116) */}
          {midiConnected && (
            <div className="midi-status">
              <h2 className="jam-room__section-title">🎛️ MIDI</h2>
              {midiDevices.map(d => (
                <p key={d.id} className="midi-status__device">✅ {d.name}</p>
              ))}
            </div>
          )}
        </aside>

        <div className="jam-room__content">
          <Visualizer width={800} height={250} notesRef={visualizerNotesRef} />

          {engine && (
            <Keyboard
              engine={engine}
              peerId="local"
              onNoteEvent={handleLocalNoteEvent}
            />
          )}
        </div>
      </div>

      <MetricsPanel
        metrics={metrics}
        wsRtt={wsRtt}
        clockOffset={clockOffset}
      />

      <AiDebugPanel
        entries={aiDebugEntries}
        onModelChange={handleModelChange}
      />
    </div>
  );
}
