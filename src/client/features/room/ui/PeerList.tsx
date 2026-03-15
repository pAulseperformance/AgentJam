import type { Peer } from '@/shared/protocol';

interface PeerListProps {
  peers: Peer[];
}

/**
 * Displays all connected peers in the jam room with color-coded indicators.
 */
export function PeerList({ peers }: PeerListProps) {
  if (peers.length === 0) {
    return (
      <div className="peer-list peer-list--empty">
        <p>No one here yet…</p>
      </div>
    );
  }

  return (
    <ul className="peer-list" role="list" aria-label="Connected peers">
      {peers.map((peer) => (
        <li key={peer.peerId} className="peer-list__item">
          <span
            className="peer-list__dot"
            style={{ backgroundColor: peer.color }}
            aria-hidden="true"
          />
          <span className="peer-list__name">{peer.name}</span>
          <span className="peer-list__badge">
            {peer.kind === 'agent' ? '🤖' : '🎹'}
          </span>
          <span className="peer-list__instrument">{peer.instrument}</span>
        </li>
      ))}
    </ul>
  );
}
