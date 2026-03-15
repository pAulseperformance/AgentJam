import { useState, useCallback } from 'react';
import type { Peer } from '@/shared/protocol';
import type { AudioEngine } from '@/client/features/synth/lib/audio-engine';

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
}

/**
 * Displays connected peers with per-peer volume & mute controls.
 */
export function PeerList({ peers, engine, localPeerId }: PeerListProps) {
  const [mixState, setMixState] = useState<Map<string, PeerMixState>>(new Map());
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

          return (
            <li key={peer.peerId} className="peer-list__item">
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
              </div>

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
