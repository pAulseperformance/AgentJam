import { useState, useCallback } from 'react';
import type { Peer } from '@/shared/protocol';
import { STYLE_ROWS } from '@/shared/music/styles';
import { INSTRUMENT_LIST } from '@/client/features/synth';

interface AgentPanelProps {
  /** Send a WS message to the server */
  sendMessage: (msg: string) => void;
  /** Current peers in the room */
  peers: Peer[];
  /** The room's vibe: what a new bot is born into when the form is left alone */
  roomVibe?: string;
}

/**
 * THE STYLE LIST IS THE REGISTRY'S. It used to be four hand-written options, which meant a style added
 * to the table was invisible here and a style removed from it stayed on this list.
 */
const AGENT_STYLES = STYLE_ROWS.map(row => ({
  value: row.id,
  label: `${row.icon} ${row.label}`,
  desc: row.verbs,
}));

const MAX_AGENTS = 4;

/**
 * AgentPanel, spawn and despawn AI agents from the browser UI.
 * Sends spawn_agent / despawn_agent messages via WebSocket.
 */
export function AgentPanel({ sendMessage, peers, roomVibe }: AgentPanelProps) {
  // The form opens on the room's vibe, and a person can still pick another style for this one bot.
  const [selectedStyle, setSelectedStyle] = useState<string>(roomVibe ?? 'jazz');
  // THE VOICE a bot is born with: the style row's own unless a person picks otherwise.
  const [selectedInstrument, setSelectedInstrument] = useState('');
  // WHERE IT SITS: auto means the first seat the room has not covered.
  const [selectedSeat, setSelectedSeat] = useState('auto');
  const rowInstrument = STYLE_ROWS.find(row => row.id === selectedStyle)?.instrument ?? 'PolySynth';
  const [agentName, setAgentName] = useState('');
  const [spawning, setSpawning] = useState(false);

  // THE RHYTHM SECTION: a drummer and a bass player are room layers, not models. They are on when a
  // peer of that name is in the room, so a second visitor sees the same state without asking.
  const hasDrummer = peers.some(p => p.kind === 'agent' && p.name === 'Drummer');
  const hasBass = peers.some(p => p.kind === 'agent' && p.name === 'Bass');
  const toggleBacking = useCallback((drummer: boolean, bass: boolean) => {
    sendMessage(JSON.stringify({ type: 'set_backing', drummer, bass }));
  }, [sendMessage]);

  const agentPeers = peers.filter(p => p.kind === 'agent' && p.name !== 'Drummer' && p.name !== 'Bass');
  const canSpawn = agentPeers.length < MAX_AGENTS;

  const handleSpawn = useCallback(() => {
    const name = agentName.trim() || `${selectedStyle.charAt(0).toUpperCase() + selectedStyle.slice(1)} Bot`;
    setSpawning(true);

    sendMessage(JSON.stringify({
      type: 'spawn_agent',
      name,
      style: selectedStyle,
      // THE VOICE AND THE SEAT travel with the spawn. An empty voice means the style row's own, and an
      // 'auto' seat means the first one the room has not covered, so the form can stay out of the way.
      ...(selectedInstrument ? { instrument: selectedInstrument } : {}),
      ...(selectedSeat !== 'auto' ? { seat: selectedSeat } : {}),
    }));

    setAgentName('');
    // Brief delay to show spawning state
    setTimeout(() => setSpawning(false), 500);
  }, [sendMessage, selectedStyle, selectedInstrument, selectedSeat, agentName]);

  const handleDespawn = useCallback((agentPeerId: string) => {
    sendMessage(JSON.stringify({
      type: 'despawn_agent',
      agentPeerId,
    }));
  }, [sendMessage]);

  return (
    <div className="agent-panel">
      <h3 className="agent-panel__title">🤖 AI Agents</h3>

      {/* Spawn form */}
      {canSpawn ? (
        <div className="agent-panel__spawn">
          <input
            type="text"
            className="agent-panel__name-input"
            placeholder="Agent name (optional)"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            maxLength={20}
            onKeyDown={(e) => {
              // Enter spawns, then focus LEAVES the field: leaving it focused is how the piano goes
              // silent after someone names an agent.
              if (e.key === 'Enter') { e.currentTarget.blur(); handleSpawn(); }
            }}
          />
          <div className="agent-panel__style-grid">
            {AGENT_STYLES.map(s => (
              <button
                key={s.value}
                className={`agent-panel__style-btn ${selectedStyle === s.value ? 'agent-panel__style-btn--active' : ''}`}
                onClick={() => setSelectedStyle(s.value)}
                title={s.desc}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* THE VOICE AND THE SEAT. The voice defaults to the style row's own instrument, which is
              what makes a latin row that names a pluck heard as a pluck; the seat defaults to auto, and
              the room fills the first one it has not covered. */}
          <div className="agent-panel__row" style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
            <label htmlFor="agent-instrument" style={{ fontSize: 12, opacity: 0.8 }}>
              Voice
              <select
                id="agent-instrument"
                value={selectedInstrument}
                onChange={event => setSelectedInstrument(event.target.value)}
                style={{ display: 'block', marginTop: 2 }}
              >
                <option value="">{rowInstrument} (from the style)</option>
                {INSTRUMENT_LIST.map(entry => (
                  <option key={entry.value} value={entry.value}>
                    {entry.icon} {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="agent-seat" style={{ fontSize: 12, opacity: 0.8 }}>
              Seat
              <select
                id="agent-seat"
                value={selectedSeat}
                onChange={event => setSelectedSeat(event.target.value)}
                style={{ display: 'block', marginTop: 2 }}
              >
                <option value="auto">auto (first free)</option>
                <option value="lead">lead</option>
                <option value="answer">answer</option>
                <option value="ornament">ornament</option>
                <option value="drums">drums</option>
                <option value="bass">bass</option>
              </select>
            </label>
          </div>

          <button
            className="agent-panel__spawn-btn"
            onClick={handleSpawn}
            disabled={spawning}
          >
            {spawning ? '⏳ Spawning...' : '➕ Spawn Agent'}
          </button>
        </div>
      ) : (
        <p className="agent-panel__limit">Max {MAX_AGENTS} agents reached</p>
      )}

      {/* Active agents list */}
      {agentPeers.length > 0 && (
        <ul className="agent-panel__list" role="list">
          {agentPeers.map(agent => (
            <li key={agent.peerId} className="agent-panel__agent">
              <span
                className="agent-panel__dot"
                style={{ backgroundColor: agent.color }}
              />
              <span className="agent-panel__agent-name">{agent.name}</span>
              <button
                className="agent-panel__despawn-btn"
                onClick={() => handleDespawn(agent.peerId)}
                title={`Remove ${agent.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {agentPeers.length === 0 && (
        <p className="agent-panel__empty">No agents yet, spawn one above!</p>
      )}

      {/* The rhythm section: instant, free, and the thing that sets the tempo */}
      <h3 className="agent-panel__title" style={{ marginTop: '1rem' }}>🥁 Rhythm section</h3>
      <div className="agent-panel__style-grid">
        <button
          className={`agent-panel__style-btn ${hasDrummer ? 'agent-panel__style-btn--active' : ''}`}
          onClick={() => toggleBacking(!hasDrummer, hasBass)}
          title="A drummer that counts the room in and keeps the groove. It sets the tempo."
        >
          🥁 Drummer {hasDrummer ? 'on' : 'off'}
        </button>
        <button
          className={`agent-panel__style-btn ${hasBass ? 'agent-panel__style-btn--active' : ''}`}
          onClick={() => toggleBacking(hasDrummer, !hasBass)}
          title="A bass player holding the harmony underneath everyone."
        >
          🎸 Bass {hasBass ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
