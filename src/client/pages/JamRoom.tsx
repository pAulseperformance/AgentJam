import { useCallback, useRef, useState, useMemo, useEffect } from 'react';
import { useRoomSocket, PeerList, TransportBar, AgentPanel, MetricsPanel, AiDebugPanel, SessionPanel, tempoMarkOf, sessionSnapshot } from '@/client/features/room';
import { useSynthEngine, Keyboard, useMidi, type InstrumentType } from '@/client/features/synth';
import { DEFAULT_INSTRUMENT } from '@/shared/music/instruments';
import { defaultPatchFor, type Patch } from '@/shared/music/patch';
import { PatchPanel } from '@/client/features/synth';
import { Visualizer, VisualizerDock } from '@/client/features/visualizer';
import { panForIndex } from '@/client/features/visualizer/lib/stereo';
import type { NoteEvent, Peer } from '@/shared/protocol';
import { slotDelayMs } from '@/client/features/room/lib/note-clock';

interface JamRoomProps {
  roomId: string;
  playerName: string;
}

/**
 * JamRoom, the main page that assembles all features.
 *
 * Phase 3 additions:
 * - AgentPanel for spawning/despawning AI agents (TAS-104)
 * - MetricsPanel for live performance stats (TAS-106)
 * - Event backfill handled by useRoomSocket (TAS-105)
 */
export function JamRoom({ roomId, playerName }: JamRoomProps) {
  const { engine, startAudio } = useSynthEngine();
  const [audioStarted, setAudioStarted] = useState(false);
  const [currentInstrument, setCurrentInstrument] = useState<InstrumentType>(DEFAULT_INSTRUMENT);
  // THE PATCH PANEL EDITS ONE CARD AT A TIME, and the edit is optimistic: the sliders move on the frame
  // you drag them, and the send that tells the room is throttled so a sweep is one message, not sixty.
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [draftPatches, setDraftPatches] = useState<Map<string, Patch>>(() => new Map());
  const patchSendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** what the engine already holds per peer, so a repeated frame does not cut a held note */
  const appliedPatchesRef = useRef<Map<string, string>>(new Map());
  const [isRecording, setIsRecording] = useState(false);

  // WHO IS PLAYING. The socket does not carry the answer to the page, so it is asked once, from the
  // same origin and with the same cookie the door reads. A failed call leaves the page in public
  // mode, which is the tier that needs no identity anyway.
  const [who, setWho] = useState<{ signedIn: boolean; name: string | null; signInUrl: string | null } | null>(null);
  useEffect(() => {
    const mount = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
    let alive = true;
    fetch(`${mount}/api/whoami`, { credentials: 'same-origin' })
      .then(async (r) => (r.ok ? (await r.json() as { signedIn: boolean; name: string | null; signInUrl: string | null }) : null))
      .then((body) => {
        if (alive && body) setWho(body);
      })
      .catch(() => { /* public tier */ });
    return () => { alive = false; };
  }, []);

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

  // Handle incoming remote note events, bypass React entirely
  /** who had a voice last time, so a departure can be told from a peer that was never heard */
  const knownPeersRef = useRef<Set<string>>(new Set());

  const handleRemoteNoteEvent = useCallback((event: NoteEvent) => {
    if (!engine) return;

    // Route to AudioEngine on the note's own SLOT, not on arrival. The server stamps `in` as a delay
    // from the moment the message left, so the browser needs no clock agreement with it, and a busy
    // main thread no longer moves the note: it plays at the time the bar clock named.
    const delay = slotDelayMs(event.in);
    if (delay === null) {
      // Its slot has gone. A dropped note leaves a hole in a bar; a shoved one plays off the grid.
      return;
    }
    if (event.type === 'note_on') {
      engine.playNote(event.pitch, event.velocity, true, event.peerId, delay);
    } else if (delay > 0) {
      setTimeout(() => engine.releaseNote(event.pitch, event.peerId), delay);
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

    // THE BUFFER IS A WINDOW, NOT A LOG. Nothing pruned it, and both note views scan it every frame: a
    // recorded session of 198 s carried 2,943 events, so an hour is about 53,000 entries read once per
    // peer per frame, which is where a pane starts dropping frames late in a set. Pruned once per event
    // rather than per note-off loop, and only when the buffer has actually grown.
    if (notes.length > 512) {
      const cutoff = performance.now() - 12000;
      const keepFrom = notes.findIndex(entry => (entry.endTime ?? entry.startTime) >= cutoff);
      if (keepFrom > 0) notes.splice(0, keepFrom);
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
    agentParts,
    patches,
  } = useRoomSocket({
    roomId,
    playerName,
    playerKind: 'human',
    onNoteEvent: handleRemoteNoteEvent,
  });

  const handleModelChange = useCallback((agentPeerId: string, model: string) => {
    sendMessage(JSON.stringify({ type: 'set_agent_model', agentPeerId, model }));
  }, [sendMessage]);

  // WHERE ONE BAR PER BAR STOPS BEING POSSIBLE. Every bar the room publishes carries the ceiling its
  // pacing came from (the slowest agent's is the room's), and the recorder holds those records; the
  // socket's `aiDebugEntries` is the change trigger, the same one the session panel takes, because the
  // recorder has no event of its own. Nothing is drawn until an agent has published a paced bar.
  const tempoMark = useMemo(
    () => tempoMarkOf(sessionSnapshot().bars, roomState?.bpm ?? null),
    [aiDebugEntries, roomState?.bpm],
  );

  // Keep color map in sync with peer list
  useMemo(() => updateColorMap(peers), [peers, updateColorMap]);

  // EVERY PEER PLAYS ITS OWN INSTRUMENT. The drummer is a membrane voice and the bass sits low; the
  // engine used to give every remote peer a copy of the classic synth, so a drummer sounded like a
  // piano. Idempotent, so a repeated peer list costs nothing.
  useEffect(() => {
    if (!engine) return;
    const present = new Set(peers.map(p => p.peerId));
    // A PEER THAT LEFT GIVES ITS VOICES BACK, or every departing drummer leaks a gain and four voices.
    for (const peerId of knownPeersRef.current) {
      if (!present.has(peerId)) engine.removePeer(peerId);
    }
    knownPeersRef.current = present;
    for (const peer of peers) {
      if (peer.instrument) engine.setPeerInstrument(peer.peerId, peer.instrument as InstrumentType);
    }
    // A HAND-BUILT VOICE WINS OVER THE PRESET. The room sends the patch with every agent frame; the
    // engine only rebuilds when the numbers actually changed, because rebuilding a voice mid-phrase
    // cuts the note being held.
    for (const [peerId, patch] of patches) {
      const applied = appliedPatchesRef.current.get(peerId);
      const next = JSON.stringify(patch);
      if (applied === next) continue;
      appliedPatchesRef.current.set(peerId, next);
      engine.setPeerPatch(peerId, patch);
    }
    // THE BAND GETS A FIELD, AND YOU STAY IN THE MIDDLE OF IT. A human is placed centre because your
    // own playing is the reference; the bots spread to the sides by their order at the table, the first
    // one left, the next right, narrowing as the room fills. Sorting by peerId keeps the layout the
    // same on every listener's machine, so two people in the same room hear the same band.
    const order = [...peers].sort((a, b) => (a.peerId < b.peerId ? -1 : 1));
    const agents = order.filter(peer => peer.kind === 'agent');
    for (const peer of order) {
      if (peer.kind === 'human') {
        engine.setPeerPan(peer.peerId, 0);
        continue;
      }
      const seat = agents.findIndex(candidate => candidate.peerId === peer.peerId);
      engine.setPeerPan(peer.peerId, panForIndex(seat + 1, agents.length + 1));
    }
  }, [peers, engine, patches]);

  // Derive local peerId, the peer whose name matches ours
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

  const handleVibeChange = useCallback((vibe: string) => {
    sendMessage(JSON.stringify({ type: 'set_vibe', vibe }));
  }, [sendMessage]);

  const handleBpmChange = useCallback((bpm: number) => {
    sendMessage(JSON.stringify({ type: 'bpm_change', bpm }));
  }, [sendMessage]);

  const handleKeyChange = useCallback((key: string) => {
    sendMessage(JSON.stringify({ type: 'key_change', key }));
  }, [sendMessage]);

  // THE ROOM'S FILL, AS ONE SWITCH. On, a bar the agent did not answer with the model is silence, so
  // an agent writing every second bar is HEARD writing every second bar. Off is the room's default.
  // The value is read from `room_state` rather than kept here: the setting belongs to the room, and a
  // listener who joins after it was set must see the same one.
  const gapRests = roomState?.gapRests === true;
  const handleGapRestsChange = useCallback((enabled: boolean) => {
    sendMessage(JSON.stringify({ type: 'set_gap_rests', enabled }));
  }, [sendMessage]);

  // ONE CALL, FOUR BARS. Off by default: the room asks for one bar at a time, which is the shape every
  // measurement in this repo was taken against. On, the agent is asked for a whole phrase on the bar
  // that opens it, so it is heard as one idea and costs a quarter of the calls.
  // ABSENT MEANS ON, the same rule the server applies: a room that has never chosen is asked for phrases.
  const phraseAsk = roomState ? roomState.phraseAsk !== false : true;
  const handlePhraseAskChange = useCallback((enabled: boolean) => {
    sendMessage(JSON.stringify({ type: 'set_phrase_ask', enabled }));
  }, [sendMessage]);

  /**
   * THE SELECTED CARD'S VOICE. Falls back to the last patch the room sent, then to the preset the card
   * names, so the panel is never empty and never shows a sound the room is not playing.
   */
  const selectedPeer = useMemo(
    () => peers.find(peer => peer.peerId === selectedPeerId) ?? null,
    [peers, selectedPeerId],
  );
  const selectedPatch = useMemo<Patch | null>(() => {
    if (!selectedPeer) return null;
    return draftPatches.get(selectedPeer.peerId)
      ?? patches.get(selectedPeer.peerId)
      ?? defaultPatchFor((selectedPeer.instrument ?? DEFAULT_INSTRUMENT) as InstrumentType);
  }, [selectedPeer, draftPatches, patches]);

  /**
   * A SLIDER MOVES THE ROOM, NOT ONLY THE PAGE. The draft is applied locally at once so the control feels
   * direct, and the message to the server rides a short trailing timer so a sweep is one send.
   */
  const handlePatchChange = useCallback((patch: Patch) => {
    const peerId = selectedPeer?.peerId;
    if (!peerId) return;
    setDraftPatches(prev => new Map(prev).set(peerId, patch));
    appliedPatchesRef.current.set(peerId, JSON.stringify(patch));
    engine?.setPeerPatch(peerId, patch);
    if (patchSendTimer.current) clearTimeout(patchSendTimer.current);
    patchSendTimer.current = setTimeout(() => {
      sendMessage(JSON.stringify({ type: 'set_agent_patch', agentPeerId: peerId, patch }));
    }, 140);
  }, [selectedPeer, engine, sendMessage]);

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
        {who?.signedIn ? (
          <span className="jam-room__tier jam-room__tier--signed">
            🧭 Jev agent · {who.name ?? 'signed in'}
          </span>
        ) : who ? (
          <a className="jam-room__tier jam-room__tier--public" href={who.signInUrl ?? 'https://auth.zpe.vc/auth'}>
            🎛 Free agent · sign in for the Jev agent →
          </a>
        ) : null}
      </header>

      <TransportBar
        roomState={roomState}
        status={status}
        onBpmChange={handleBpmChange}
        onKeyChange={handleKeyChange}
        onInstrumentChange={handleInstrumentChange}
        currentInstrument={currentInstrument}
        onVibeChange={handleVibeChange}
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
      />

      {/* THE CEILING, MARKED WHERE THE TEMPO IS SET. One line, the number in words: above it the room
          spreads one bar of music over more than one bar, and the line says what the slowest agent
          does there. Amber, not rose: it is a limit being crossed, not a failure. */}
      {tempoMark.label && (
        <p
          className="jam-room__tempo-ceiling"
          style={{
            margin: '8px 2px 0',
            color: tempoMark.over ? 'var(--accent-amber)' : 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 2,
              height: 10,
              marginRight: 6,
              verticalAlign: '-1px',
              background: tempoMark.over ? 'var(--accent-amber)' : 'var(--text-secondary)',
            }}
          />
          {tempoMark.label}
        </p>
      )}

      {/* WHAT A BAR WITH NO MODEL LINE DOES, where the tempo is set. On, the room's own fill stops
          covering the gap: the agent's cells above a stride of one and the generator's line at a stride
          of one are replaced by silence, which is how a slower agent's rate becomes audible. The
          checkbox reads `room_state`, so it shows the setting the ROOM is under, not what this tab
          once asked for. */}
      <div
        className="jam-room__gap-rests"
        style={{ margin: '8px 2px 0', fontSize: 13, color: 'var(--text-secondary)' }}
      >
        <label htmlFor="gap-rests" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          {/* A GUEST CANNOT SET IT: the switch silences the room's fill for everyone listening, and
              the room refuses the frame from a public socket anyway. Showing it live but dead is the
              lamp the room disagrees with, so it is disabled and says why. */}
          <input
            id="gap-rests"
            type="checkbox"
            checked={gapRests}
            disabled={status !== 'connected' || !who?.signedIn}
            onChange={(e) => handleGapRestsChange(e.target.checked)}
          />
          <span>Gap bars rest</span>
        </label>
        {who?.signedIn ? null : (
          <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>(signed-in listeners only)</span>
        )}
        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
          {gapRests
            ? 'on: the space between the bars each agent writes is silence'
            : 'off: the room fills the bars an agent does not write'}
        </span>
      </div>

      <div
        className="jam-room__phrase-ask"
        style={{ margin: '4px 2px 0', fontSize: 13, color: 'var(--text-secondary)' }}
      >
        <label htmlFor="phrase-ask" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            id="phrase-ask"
            type="checkbox"
            checked={phraseAsk}
            disabled={status !== 'connected'}
            onChange={(e) => handlePhraseAskChange(e.target.checked)}
          />
          <span>Four bars per call</span>
        </label>
        <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
          {phraseAsk
            ? 'on: one model call writes a whole phrase, so the ending is part of the idea'
            : 'off: the model writes one bar at a time'}
        </span>
      </div>

      <div className="jam-room__main">
        <aside className="jam-room__sidebar">
          <h2 className="jam-room__section-title">Peers</h2>
          <PeerList
            peers={peers}
            engine={engine}
            localPeerId={localPeerId}
            agentParts={agentParts}
            onChangePart={(peerId, part) => sendMessage(JSON.stringify({ type: 'set_agent_part', agentPeerId: peerId, ...part }))}
            onDespawn={(peerId) => sendMessage(JSON.stringify({ type: 'despawn_agent', agentPeerId: peerId }))}
            selectedPeerId={selectedPeerId ?? undefined}
            onSelect={(peerId) => setSelectedPeerId(current => (current === peerId ? null : peerId))}
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
          {/* SIDE BY SIDE, because stacked they do not fit. Measured at a 1280 by 800 viewport with the
              panes under the keys: roll 321 to 585, keyboard 689 to 829, dock 853 to 1090, so the keys
              were cut off and the dock began below the fold. The roll keeps its place and its size; the
              dock sits beside it and the keys stay under both. */}
          <Visualizer width={800} height={120} notesRef={visualizerNotesRef} />

          {engine && (
            <Keyboard
              engine={engine}
              peerId="local"
              onNoteEvent={handleLocalNoteEvent}
              musicalKey={roomState?.key}
            />
          )}

          {/* THE DOCK SITS UNDER THE KEYS, which is where it was asked for twice. The roll above them got
              shorter to pay for it: at 1280 by 800 the keys and the dock both have to be on screen. */}
          <VisualizerDock
            patchPanel={selectedPatch ? (
              <PatchPanel
                name={selectedPeer?.name ?? 'this player'}
                patch={selectedPatch}
                editable={selectedPeer?.kind === 'agent'}
                onChange={handlePatchChange}
              />
            ) : undefined}
            engine={engine ?? null}
            notesRef={visualizerNotesRef as unknown as React.RefObject<import('@/client/features/visualizer/ui/BandViewPane').BandNote[]>}
            names={new Map(peers.map(peer => [peer.peerId, peer.name]))}
            width={800}
            height={170}
          />
        </div>
      </div>

      <MetricsPanel
        metrics={metrics}
        wsRtt={wsRtt}
        clockOffset={clockOffset}
      />

      <AiDebugPanel
        entries={aiDebugEntries}
        signedIn={who?.signedIn ?? false}
        onModelChange={handleModelChange}
      />

      {/* THE SESSION PANEL sits at the page foot, after the other after-the-fact card, so a listener
          never scrolls past a retrospective summary to reach the live surface. It takes the same `who`
          answer the debug panel takes, and `aiDebugEntries` doubles as its change trigger: the
          recorder has no event of its own (see the panel's own comment). */}
      <SessionPanel
        signedIn={who ? who.signedIn : null}
        entries={aiDebugEntries}
      />
    </div>
  );
}
