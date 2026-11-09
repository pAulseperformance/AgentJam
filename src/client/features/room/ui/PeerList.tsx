import { useState, useCallback } from 'react';
import type { Peer } from '@/shared/protocol';
import type { AudioEngine } from '@/client/features/synth';
import { STYLE_ROWS } from '@/shared/music/styles';
import { INSTRUMENT_GROUPS } from '@/client/features/synth';

interface PeerMixState {
  volume: number;
  muted: boolean;
}

interface PeerListProps {
  peers: Peer[];
  /** Audio engine ref for volume/mute control */
  engine?: AudioEngine | null;
  /** Local peer's peerId */
  localPeerId?: string;
  /** Each agent's style and seat, so its card can show and change them */
  agentParts?: Map<string, { style: string; seat: string }>;
  /** Write a change to one agent's part: style, voice or seat */
  onChangePart?: (peerId: string, part: { style?: string; instrument?: string; seat?: string }) => void;
  /** Remove an agent */
  onDespawn?: (peerId: string) => void;
  /** The card the patch panel is editing */
  selectedPeerId?: string;
  onSelect?: (peerId: string) => void;
}

const SEATS = ['lead', 'answer', 'ornament', 'drums', 'bass'] as const;

/**
 * Displays connected peers with per-peer volume & mute controls.
 */
export function PeerList({ peers, engine, localPeerId, agentParts, onChangePart, onDespawn, selectedPeerId, onSelect }: PeerListProps) {
  const [mixState, setMixState] = useState<Map<string, PeerMixState>>(new Map());
  /**
   * WHICH CARDS ARE FOLDED. A room with six players was six blocks of three dropdowns, so the sidebar became a
   * wall and the mixer you actually use was pushed off it. A card opens on the player you are editing and folds
   * otherwise; the chevron overrides, and the controls stay mounted so a probe can still count them.
   */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [masterMuted, setMasterMuted] = useState(false);
  const [masterVolume, setMasterVolume] = useState(1);

  const getPeerMix = (peerId: string): PeerMixState =>
    mixState.get(peerId) ?? { volume: 1, muted: false };

  const handleVolumeChange = useCallback((peerId: string, volume: number) => {
    setMixState(prev => {
      const next = new Map(prev);
      next.set(peerId, { ...getPeerMix(peerId), volume });
      return next;
    });
    engine?.setPeerVolume(peerId, volume);
  }, [engine]);

  const handleMuteToggle = useCallback((peerId: string) => {
    setMixState(prev => {
      const next = new Map(prev);
      const current = prev.get(peerId) ?? { volume: 1, muted: false };
      const newMuted = !current.muted;
      next.set(peerId, { ...current, muted: newMuted });
      engine?.setMuted(peerId, newMuted);
      return next;
    });
  }, [engine]);

  const handleMasterVolume = useCallback((vol: number) => {
    setMasterVolume(vol);
    engine?.setMasterVolume(vol);
  }, [engine]);

  const handleMasterMute = useCallback(() => {
    const newMuted = !masterMuted;
    setMasterMuted(newMuted);
    engine?.setMasterMuted(newMuted);
  }, [engine, masterMuted]);

  if (peers.length === 0) {
    return (
      <div className="peer-list peer-list--empty">
        <p>No one here yet…</p>
      </div>
    );
  }

  return (
    <div className="peer-list-container">
      {/* Master volume */}
      <div className="peer-mixer peer-mixer--master">
        <button
          className={`peer-mixer__mute ${masterMuted ? 'peer-mixer__mute--active' : ''}`}
          onClick={handleMasterMute}
          title={masterMuted ? 'Unmute self' : 'Mute self'}
        >
          {masterMuted ? '🔇' : '🔊'}
        </button>
        <span className="peer-mixer__label">Master</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={masterMuted ? 0 : masterVolume}
          onChange={(e) => handleMasterVolume(parseFloat(e.target.value))}
          className="peer-mixer__slider"
          title="Master volume"
        />
      </div>

      <hr className="peer-list__divider" />

      {/* Peer list with per-peer controls */}
      <ul className="peer-list" role="list" aria-label="Connected peers">
        {peers.map((peer) => {
          const isLocal = peer.peerId === localPeerId;
          const mix = getPeerMix(peer.peerId);
          // THE PART CONTROLS LIVE ON THE CARD, and only for a bot the room can actually change: a
          // backing drummer is a layer, not an agent in the roster, so it carries no style or seat.
          const part = agentParts?.get(peer.peerId);
          const isFolded = folded[peer.peerId] ?? (selectedPeerId !== peer.peerId);

          return (
            <li
              key={peer.peerId}
              className={`peer-list__item ${selectedPeerId === peer.peerId ? 'peer-list__item--selected' : ''}`}
              data-peer={peer.peerId}
              data-selected={selectedPeerId === peer.peerId ? 'yes' : 'no'}
              onClick={() => onSelect?.(peer.peerId)}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
            >
              <div className="peer-list__info">
                <span
                  className="peer-list__dot"
                  style={{ backgroundColor: peer.color }}
                  aria-hidden="true"
                />
                <span className="peer-list__name">{peer.name}</span>
                <span className="peer-list__badge">
                  {peer.kind === 'agent' ? '🤖' : '🎹'}
                </span>
                {part && (
                  <button
                    className="peer-list__fold"
                    data-fold={peer.peerId}
                    aria-expanded={!isFolded}
                    title={isFolded ? `Show ${peer.name}'s controls` : `Hide ${peer.name}'s controls`}
                    onClick={event => {
                      event.stopPropagation();
                      setFolded(prev => ({ ...prev, [peer.peerId]: !isFolded }));
                    }}
                  >
                    {isFolded ? '▸' : '▾'}
                  </button>
                )}
                {part && onDespawn && (
                  <button
                    className="peer-list__kill"
                    onClick={() => onDespawn(peer.peerId)}
                    title={`Remove ${peer.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>

              {part && onChangePart && (
                <div className="peer-list__part" data-folded={isFolded ? 'yes' : 'no'} // STACKED, because these live in a narrow column: three selects side by side in a
                // 240 px sidebar are three unreadable slivers. `display` is set here rather than left to the
                // `hidden` attribute, which an inline `display: grid` overrides: measured, the chevron flipped
                // its arrow while the 114px block of controls stayed on screen.
                style={{ display: isFolded ? 'none' : 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 3, margin: '5px 0 2px' }}>
                  <select
                    aria-label={`${peer.name} style`}
                    data-agent-part={`${peer.peerId}-style`}
                    value={part.style}
                    onChange={event => onChangePart(peer.peerId, { style: event.target.value })}
                    style={{ fontSize: 11 }}
                  >
                    {STYLE_ROWS.map(row => (
                      <option key={row.id} value={row.id}>{row.icon} {row.label}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`${peer.name} voice`}
                    data-agent-part={`${peer.peerId}-voice`}
                    value={peer.instrument}
                    onChange={event => onChangePart(peer.peerId, { instrument: event.target.value })}
                    style={{ fontSize: 11 }}
                  >
                    {/* GROUPED BY FAMILY, because twelve patches in one list is a list; keys, pads, leads,
                        basses and plucks is a catalogue a person can find their instrument in. */}
                    {INSTRUMENT_GROUPS.map(group => (
                      <optgroup key={group.family} label={group.family}>
                        {group.entries.map(entry => (
                          <option key={entry.value} value={entry.value}>{entry.icon} {entry.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <select
                    aria-label={`${peer.name} seat`}
                    data-agent-part={`${peer.peerId}-seat`}
                    value={part.seat}
                    onChange={event => onChangePart(peer.peerId, { seat: event.target.value })}
                    style={{ fontSize: 11 }}
                  >
                    {SEATS.map(seat => (
                      <option key={seat} value={seat}>{seat}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Volume controls — only for remote peers */}
              {!isLocal && (
                <div className="peer-mixer">
                  <button
                    className={`peer-mixer__mute ${mix.muted ? 'peer-mixer__mute--active' : ''}`}
                    onClick={() => handleMuteToggle(peer.peerId)}
                    title={mix.muted ? `Unmute ${peer.name}` : `Mute ${peer.name}`}
                  >
                    {mix.muted ? '🔇' : '🔉'}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={mix.muted ? 0 : mix.volume}
                    onChange={(e) => handleVolumeChange(peer.peerId, parseFloat(e.target.value))}
                    className="peer-mixer__slider"
                    title={`${peer.name} volume`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
