import { useState, useCallback } from 'react';
import type { Peer } from '@/shared/protocol';

interface AgentPanelProps {
  /** Send a WS message to the server */
  sendMessage: (msg: string) => void;
  /** Current peers in the room */
  peers: Peer[];
  /** The room's vibe: what a new bot is born into when the form is left alone */
  roomVibe?: string;
  /** Each agent's style and seat, from agent_spawned, so the card can show and change them */
  agentParts?: Map<string, { style: string; seat: string }>;
}

/**
 * THE STYLE LIST IS THE REGISTRY'S. It used to be four hand-written options, which meant a style added
 * to the table was invisible here and a style removed from it stayed on this list.
 */
const MAX_AGENTS = 4;

/** The five seats, in the order the room fills them. */
const SEATS = ['lead', 'answer', 'ornament', 'drums', 'bass'] as const;

/**
 * AgentPanel, spawn and despawn AI agents from the browser UI.
 * Sends spawn_agent / despawn_agent messages via WebSocket.
 */
export function AgentPanel({ sendMessage, peers, roomVibe, agentParts }: AgentPanelProps) {
  // A PART'S STYLE, VOICE AND SEAT ARE NOT ON THIS FORM. They are on the agent's card, where they belong.
  void roomVibe;
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

  /**
   * THE NEXT PLAYER THE ROOM IS MISSING. The button names the seat it will fill, so a person pressing it
   * knows what is about to walk in; the server applies the same order, so the label cannot disagree with
   * what lands unless the room changed between the render and the press.
   */
  const nextSeat = useCallback((): (typeof SEATS)[number] => {
    const taken = new Set<string>();
    for (const agent of agentPeers) {
      const seat = agentParts?.get(agent.peerId)?.seat;
      if (seat) taken.add(seat);
    }
    if (hasDrummer) taken.add('drums');
    if (hasBass) taken.add('bass');
    return SEATS.find(seat => !taken.has(seat)) ?? 'ornament';
  }, [agentPeers, agentParts, hasDrummer, hasBass]);

  const handleSpawn = useCallback(() => {
    const seat = nextSeat();
    const name = agentName.trim() || `${seat.charAt(0).toUpperCase()}${seat.slice(1)} bot`;
    setSpawning(true);

    // THE BUTTON SENDS A NAME AND A SEAT, and nothing else. The style comes from the room's vibe and the
    // voice from that style's row; both are then edited on the agent's own card, which is where a part's
    // settings belong. A form that also carried a style was a second place to set the same thing.
    sendMessage(JSON.stringify({
      type: 'spawn_agent',
      name,
      seat: nextSeat(),
    }));

    setAgentName('');
    // Brief delay to show spawning state
    setTimeout(() => setSpawning(false), 500);
  }, [sendMessage, agentName, nextSeat]);

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
          {/* NO STYLE HERE ANY MORE. A bot's style, voice and seat are ITS OWN, edited on its card; the
              button only decides who walks in, and the room's vibe decides what they play until you say
              otherwise on the card. */}
          <button
            className="agent-panel__spawn-btn"
            onClick={handleSpawn}
            disabled={spawning}
          >
            {spawning ? '⏳ Adding...' : `➕ Add a ${nextSeat()}`}
          </button>
        </div>
      ) : (
        <p className="agent-panel__limit">Max {MAX_AGENTS} agents reached</p>
      )}

      {/* THE AGENT CARDS LIVE IN THE PEERS PANEL. A bot's style, voice and seat sit on its own
          card there, with its volume, which is where a person looks for a player. */}

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
