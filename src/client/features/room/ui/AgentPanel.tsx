import { useState, useCallback } from 'react';
import type { Peer } from '@/shared/protocol';

interface AgentPanelProps {
  /** Send a WS message to the server */
  sendMessage: (msg: string) => void;
  /** Current peers in the room */
  peers: Peer[];
}

const AGENT_STYLES = [
  { value: 'jazz', label: '🎷 Jazz', desc: 'Swing, improv' },
  { value: 'ambient', label: '🌊 Ambient', desc: 'Long, dreamy' },
  { value: 'funk', label: '🎸 Funk', desc: 'Groovy 16ths' },
  { value: 'random', label: '🎲 Random', desc: 'Experimental' },
] as const;

const MAX_AGENTS = 4;

/**
 * AgentPanel — spawn and despawn AI agents from the browser UI.
 * Sends spawn_agent / despawn_agent messages via WebSocket.
 */
export function AgentPanel({ sendMessage, peers }: AgentPanelProps) {
  const [selectedStyle, setSelectedStyle] = useState<string>('jazz');
  const [agentName, setAgentName] = useState('');
  const [spawning, setSpawning] = useState(false);

  const agentPeers = peers.filter(p => p.kind === 'agent');
  const canSpawn = agentPeers.length < MAX_AGENTS;

  const handleSpawn = useCallback(() => {
    const name = agentName.trim() || `${selectedStyle.charAt(0).toUpperCase() + selectedStyle.slice(1)} Bot`;
    setSpawning(true);

    sendMessage(JSON.stringify({
      type: 'spawn_agent',
      name,
      style: selectedStyle,
    }));

    setAgentName('');
    // Brief delay to show spawning state
    setTimeout(() => setSpawning(false), 500);
  }, [sendMessage, selectedStyle, agentName]);

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
        <p className="agent-panel__empty">No agents yet — spawn one above!</p>
      )}
    </div>
  );
}
